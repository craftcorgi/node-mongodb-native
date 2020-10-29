'use strict';
const mocha = require('mocha');
const chalk = require('chalk').default;
const {
  EVENT_RUN_BEGIN,
  EVENT_RUN_END,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_PENDING,
  EVENT_TEST_RETRY,
  EVENT_TEST_BEGIN,
  EVENT_TEST_END,
  EVENT_HOOK_BEGIN,
  EVENT_HOOK_END,
  EVENT_DELAY_BEGIN,
  EVENT_DELAY_END
} = mocha.Runner.constants;

const fs = require('fs');

function captureStream(stream) {
  var oldWrite = stream.write;
  var buf = '';
  stream.write = function (chunk) {
    buf += chunk.toString(); // chunk is a String or Buffer
    oldWrite.apply(stream, arguments);
  };

  return {
    unhook: function unhook() {
      stream.write = oldWrite;
    },
    captured: function () {
      return buf;
    }
  };
}

/**
 * @param {Mocha.Runner} runner
 * @this {any}
 */
class MongoDBMochaReporter {
  constructor(runner) {
    this.suites = new Map();
    runner.on(EVENT_RUN_BEGIN, async () => await this.start());
    runner.on(EVENT_DELAY_BEGIN, async suite => await this.waiting(suite));
    runner.on(EVENT_DELAY_END, async () => await this.ready());
    runner.on(EVENT_RUN_END, async () => await this.end());
    runner.on(EVENT_SUITE_BEGIN, async suite => await this.onSuite(suite));
    runner.on(EVENT_TEST_BEGIN, async test => await this.onTest(test));
    runner.on(EVENT_HOOK_BEGIN, async hook => await this.onHook(hook));
    runner.on(EVENT_TEST_PASS, async test => await this.pass(test));
    runner.on(EVENT_TEST_FAIL, async (test, error) => await this.fail(test, error));
    runner.on(EVENT_TEST_PENDING, async test => await this.pending(test));
    runner.on(EVENT_TEST_RETRY, async (test, error) => await this.retry(test, error));
    runner.on(EVENT_SUITE_END, async suite => await this.suiteEnd(suite));
    runner.on(EVENT_TEST_END, async test => await this.testEnd(test));
    runner.on(EVENT_HOOK_END, async hook => await this.hookEnd(hook));

    process.on('SIGINT', async () => this.end(true));
  }
  async start() {}

  async end(ctrlC) {
    if (ctrlC) console.log('emergency exit!');
    const output = { testSuites: [] };
    for (const [id, [name, { suite }]] of [...this.suites.entries()].entries()) {
      output.testSuites.push({
        package: suite.file.includes('functional') ? 'Functional' : 'Unit',
        id,
        name,
        timestamp: suite.timestamp,
        hostname: 'localhost',
        tests: suite.tests.length,
        failures: suite.tests.filter(t => t.state === 'failed').length,
        errors: '0',
        time: suite.tests.reduce(
          (a, t) => a + (Number.isNaN(t.elapsedTime / 1000) ? 0 : t.elapsedTime / 1000),
          0
        ),
        testCases: suite.tests.map(t => ({
          name: t.title,
          className: name,
          time: Number.isNaN(t.elapsedTime / 1000) ? 0 : t.elapsedTime / 1000,
          startTime: t.startTime ? t.startTime.toISOString() : 0,
          endTime: t.endTime ? t.endTime.toISOString() : 0,
          skipped: t.skipped,
          failure: t.error
            ? {
                type: t.error.constructor.name,
                message: t.error.message,
                stack: t.error.stack
              }
            : undefined
        })),
        stdout: suite.stdout,
        stderr: suite.stderr
      });
    }

    fs.writeFileSync('xunit.xml', outputToXML(output), { encoding: 'utf8' });
    console.log(chalk.bold('wrote xunit.xml'));
    // console.log(outputToXML(output));
    // console.log(JSON.stringify(output, undefined, 4));
  }

  /**
   * @param {Mocha.Suite} suite
   */
  async waiting(suite) {}

  /**
   * @param {any[]} args
   */
  async ready(...args) {}

  /**
   * @param {Mocha.Suite} suite
   */
  async onSuite(suite) {
    if (suite.root) return;
    if (!this.suites.has(suite.fullTitle())) {
      Reflect.set(suite, 'timestamp', new Date().toISOString().split('.')[0]);
      this.suites.set(suite.fullTitle(), {
        suite,
        currentSuiteOut: captureStream(process.stdout),
        currentSuiteErr: captureStream(process.stderr)
      });
    } else {
      console.warn(`${chalk.yellow('WARNING:')}: ${suite.fullTitle()} started twice`);
    }
  }

  /**
   * @param {Mocha.Suite} suite
   */
  async suiteEnd(suite) {
    if (suite.root) return;
    const currentSuite = this.suites.get(suite.fullTitle());
    if (!currentSuite) {
      console.error('Suite never started >:(');
      process.exit(1);
    }
    if (currentSuite.currentSuiteOut) {
      suite.stdout = currentSuite.currentSuiteOut.captured();
      suite.stderr = currentSuite.currentSuiteErr.captured();
      currentSuite.currentSuiteOut.unhook();
      currentSuite.currentSuiteErr.unhook();
      delete currentSuite.currentSuiteOut;
      delete currentSuite.currentSuiteErr;
    }
  }

  /**
   * @param {Mocha.Test} test
   */
  async onTest(test) {
    Reflect.set(test, 'startTime', new Date());
  }

  /**
   * @param {Mocha.Test} test
   */
  async testEnd(test) {
    Reflect.set(test, 'endTime', new Date());
    Reflect.set(
      test,
      'elapsedTime',
      Number(Reflect.get(test, 'endTime') - Reflect.get(test, 'startTime'))
    );
  }

  /**
   * @param {Mocha.Hook} hook
   */
  async onHook(hook) {}

  /**
   * @param {Mocha.Hook} hook
   */
  async hookEnd(hook) {}

  /**
   * @param {Mocha.Test} test
   */
  async pass(test) {
    console.log(chalk.green(`✔ ${test.fullTitle()}`));
  }

  /**
   * @param {Mocha.Test} test
   * @param {{ message: any; }} error
   */
  async fail(test, error) {
    console.log(chalk.red(`⨯ ${test.fullTitle()} -- ${error.message}`));
    Reflect.set(test, 'error', error);
  }

  /**
   * @param {Mocha.Test} test
   */
  async pending(test) {
    console.log(chalk.cyan(`↬ ${test.fullTitle()}`));
    Reflect.set(test, 'skipped', true);
  }

  /**
   * @param {Mocha.Test} test
   * @param {Error} error
   */
  async retry(test, error) {}
}

module.exports = MongoDBMochaReporter;

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function outputToXML(output) {
  function cdata(str) {
    return `<![CDATA[${str.split(ANSI_ESCAPE_REGEX).join('').split(']]>').join('\\]\\]\\>')}]]>`;
  }

  function makeTag(name, attributes, selfClose, content) {
    const attributesString = Object.entries(attributes || {})
      .map(([k, v]) => `${k}="${String(v).split('"').join("'")}"`)
      .join(' ');
    let tag = `<${name}${attributesString ? ' ' + attributesString : ''}`;
    if (selfClose) return tag + '/>\n';
    else tag += '>';
    if (content) return tag + content + `</${name}>`;
    return tag;
  }

  let s =
    '<?xml version="1.0" encoding="UTF-8"?>\n<?xml-model href="./test/tools/reporter/xunit.xsd" ?>\n<testsuites>\n';

  for (const suite of output.testSuites) {
    s += makeTag('testsuite', {
      package: suite.package,
      id: suite.id,
      name: suite.name,
      timestamp: suite.timestamp,
      hostname: suite.hostname,
      tests: suite.tests,
      failures: suite.failures,
      errors: suite.errors,
      time: suite.time
    });
    s += '\n\t' + makeTag('properties') + '</properties>\n'; // can put metadata here?
    for (const test of suite.testCases) {
      s +=
        '\t' +
        makeTag(
          'testcase',
          {
            name: test.name,
            classname: test.className,
            time: test.time,
            start: test.startTime,
            end: test.endTime
          },
          !test.failure && !test.skipped
        );
      if (test.failure) {
        s +=
          '\n\t\t' +
          makeTag('failure', { type: test.failure.type }, false, cdata(test.failure.stack)) +
          '\n';
        s += `\t</testcase>\n`;
      }
      if (test.skipped) {
        s += makeTag('skipped', {}, true);
        s += `\t</testcase>\n`;
      }
    }
    s += '\t' + makeTag('system-out', {}, false, cdata(suite.stdout)) + '\n';
    s += '\t' + makeTag('system-err', {}, false, cdata(suite.stderr)) + '\n';
    s += `</testsuite>\n`;
  }

  return s + '</testsuites>\n';
}
