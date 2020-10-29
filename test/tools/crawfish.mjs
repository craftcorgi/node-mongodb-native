#! /usr/bin/env node --experimental-modules

import { createReadStream, promises } from 'fs';
const { readFile } = promises;
import { createInterface } from 'readline';
import { parseStringPromise } from 'xml2js';

let warnings = false;

/**
 * @param {string[]} args - program arguments
 */
async function main(args) {
  if (args.includes('-h') || args.includes('--help') || args.includes('-?')) return help();
  if (args.includes('-w')) warnings = true;

  const logFile = args.pop();
  const testNameRegex = args.pop();

  const content = await readFile('xunit.xml', { encoding: 'utf8' });
  const xunit = await parseStringPromise(content);

  const tests = collectTests(xunit, testNameRegex);
  if (warnings) console.error(`filtering log file ${logFile}`);

  const logStream =
    logFile === '-' ? process.stdin : createReadStream(logFile, { encoding: 'utf8' });
  const lineStream = createInterface({
    input: logStream,
    crlfDelay: Infinity
  });

  const testToLogs = new Map(tests.map(({ name }) => [name, []]));
  for await (const line of lineStream) {
    const structuredLog = JSON.parse(line);
    for (const test of tests) {
      const logTime = Date.parse(structuredLog.t.$date);
      if (logTime <= test.end && logTime >= test.start) {
        testToLogs.get(test.name).push(structuredLog);
      }
    }
  }

  for (const [name, logs] of testToLogs.entries()) {
    for (const log of logs) {
      log.testName = name;
      interpolateMsg(log);
      friendlyDate(log);
      console.log(JSON.stringify(log));
    }
  }
}

function interpolateMsg(log) {
  if (!log.msg) return;

  if (!log.attr) return;

  for (const key in log.attr) {
    if (Reflect.has(log.attr, key)) {
      log.msg = log.msg.split(`{${key}}`).join(`${JSON.stringify(log.attr[key])}`);
      delete log.attr[key];
    }
  }

  if (Object.keys(log.attr).length === 0) delete log.attr;
  log.msg = log.msg.split(`"`).join(`'`);
}

function friendlyDate(log) {
  const dateString = log.t.$date;
  log.t = new Date(Date.parse(dateString)).toISOString();
}

function collectTests(xuint, testFilter) {
  const suites = xuint.testsuites.testsuite;

  const tests = [];

  for (const suite of suites) {
    if (suite.testcase) {
      for (const test of suite.testcase) {
        const fullName = `${suite.$.name} ${test.$.name}`;
        if (fullName.toLowerCase().includes(testFilter.toLowerCase())) {
          if (test.$.start === '0') {
            if (warnings) console.error(`Warning: ${fullName} was skipped, theres no logs`);
            continue;
          }
          tests.push({
            name: fullName,
            start: Date.parse(test.$.start),
            end: Date.parse(test.$.end)
          });
        }
      }
    }
  }

  return tests;
}

function help() {
  console.log(`\u{1F9A8}  Crawfish! MongoDB logs and test pincer
  USAGE: crawfish.mjs TEST_FILTER LOG_FILE

  TEST_FILTER\tA regex to filter for the tests you care about
  LOG_FILE\tThe log file you want to pincer (you can provide '-' to read from stdin, good for cat-ing multiple log files)

    - Some log processing is done: better date time format, string interpolation, testName property added
    - Depends on an xunit file in the repo directory, should be left over from every test run.

    - Recommended usage: \`crawfish.mjs X Y | jq -SC | less -R\`
      - jq -SC will sort the keys and force color output
      - less lets you page through and search logs

      - Recommended usage: \`crawfish.mjs X Y | jq -Sc | code -\`
      - jq -Sc will sort the keys and keep the logs one line (compact)
      - code followed by a dash will open the output in vscode, good for searching!
  `);
}

main(process.argv).catch(e => {
  console.error(e);
  process.exit(1);
});
