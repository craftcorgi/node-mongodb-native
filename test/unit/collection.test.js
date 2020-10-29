'use strict';

const EventEmitter = require('events').EventEmitter;
const chai = require('chai');
const expect = chai.expect;
const { Db } = require('../../src/db');

class MockTopology extends EventEmitter {
  constructor() {
    super();
  }

  capabilities() {
    return {};
  }
}

describe('Collection (unit)', function () {
  it('should not allow atomic operators for findOneAndReplace', {
    metadata: { requires: { topology: 'single' } },
    test: function () {
      const db = new Db('fakeDb', new MockTopology());
      const collection = db.collection('test');
      expect(() => {
        collection.findOneAndReplace({ a: 1 }, { $set: { a: 14 } });
      }).to.throw(/must not contain atomic operators/);
    }
  });
});
