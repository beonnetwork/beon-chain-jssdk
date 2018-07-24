'use strict';

const createKeccakHash = require('keccak');
const utils = require('./utils');
/**
 * Merkle
 */
class Merkle {
  /**
   * Create a Merkle tree from data
   * @param {string[]} data array of hex strings representing data
   */
  constructor(data) {
    this.isReady = false;
    this.leaves = data.map(str => this._hash(this._getBuffer(str)));
    this.levels = [];
  }

  /**
   * Make the Merkle tree
   */
  makeTree() {
    this.isReady = false;
    this.levels.unshift(this.leaves);
    while (this.levels[0].length > 1) {
      this.levels.unshift(this._getNextLevel());
    }
    this.isReady = true;
  }

  /**
   * Get the Merkle root
   */
  getRoot() {
    return this.isReady ? this.levels[0][0] : null;
  }

  /**
   * Get the proof of data at index
   * @param {number} index index ot get the proof
   */
  getProof(index) {
    index = +index;
    let proof = [];
    for (let i = this.levels.length - 1; i > 0; i--) {
      let isRightNode = index % 2;
      let siblingIndex = isRightNode ? (index - 1) : (index + 1);
      // console.log(siblingIndex, i, this.levels[i][siblingIndex])
      proof.push(Buffer.from(isRightNode ? [0x00] : [0x01]));
      proof.push(this.levels[i][siblingIndex]);
      index = Math.floor(index / 2);
    }
    return utils.bufferToHex(Buffer.concat(proof), true);
  }

  _hash(value) {
    return createKeccakHash('keccak256').update(value).digest();
  }

  _getBuffer(value) {
    return Buffer.from(value, 'hex');
  }

  _getNextLevel() {
    let nodes = [];
    for (let i = 0; i < this.levels[0].length - 1; i += 2) {
      let left = this.levels[0][i];
      let right = this.levels[0][i + 1];
      nodes.push(this._hash(Buffer.concat([left, right])));
    }
    return nodes;
  }
}

module.exports = Merkle;