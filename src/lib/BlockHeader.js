'use strict';

const utils = require("./utils");
const Merkle = require("./Merkle");
const Web3 = require("web3");
/**
 * Block header
 */
class BlockHeader {
  /**
   * Create a block header
   * @param {number} blockNumber the block number
   * @param {string} previousHash hex string of previous hash
   * @param {string[]} data array of hex string representing transactions
   */
  constructor(blockNumber, previousHash, data) {
    const len = data.length;
    if (len > 256) {
      data = data.splice(0, 256);
    }
    for (let i = len; i < 256; i++) {
      data.push("");
    }
    this.blockNumber = +blockNumber;
    this.previousHash = previousHash; // 32 bytes
    this.data = data
    if (blockNumber == 0) {
      this.merkle = null;
      this.merkleRoot = "";
    } else {
      this.merkle = new Merkle(this.data.map((datum) => utils.removeHexPrefix(datum)));
      this.merkle.makeTree();
      this.merkleRoot = utils.addHexPrefix(utils.bufferToHex(this.merkle.getRoot(), false)); // 32 bytes
    }
    this.sigR = ''; // 32 bytes
    this.sigS = ''; // 32 bytes
    this.sigV = ''; // 1 byte
    this.timestamp = new Date().getTime();
  }

  /**
   * Set signature of the header
   * @param {string} signature hex string signature of the header
   */
  setSignature(signature) {
    let sig = utils.removeHexPrefix(signature);
    let sigR = sig.substring(0, 64);
    let sigS = sig.substring(64, 128);
    let sigV = parseInt(sig.substring(128, 130), 16);
    if (sigV < 27) {
      sigV += 27;
    }
    this.sigR = sigR;
    this.sigS = sigS;
    this.sigV = sigV.toString(16).padStart(2, "0");
  }

  /**
   * Sha3 hash of the hex string representing transactions in this block header
   */
  get hash() {
    return Web3.utils.sha3(utils.addHexPrefix(this.toString(true)));
  }

  /**
   * Convert this block header to string
   * @param {boolean} includingSig whether to include the signature in the block header string
   */
  toString(includingSig) {
    let blkNumHexString = this.blockNumber.toString(16).padStart(64, "0");
    let rawBlockHeader = blkNumHexString + utils.removeHexPrefix(this.previousHash) + utils.removeHexPrefix(this.merkleRoot);
    if (includingSig) {
      rawBlockHeader += this.sigR + this.sigS + this.sigV;
    }
    return rawBlockHeader;
  }

  /**
   * Create a block header from json
   * @param {Object} json json object representing block header
   */
  static fromJSON(json) {
    const len = json.data.length;
    for (let i = len; i < 256; i++) {
      json.data.push("");
    }
    let blockHeader = new BlockHeader(json.blockNumber, json.previousHash, json.data);
    blockHeader.sigR = json.sigR;
    blockHeader.sigS = json.sigS;
    blockHeader.sigV = json.sigV;
    blockHeader.timestamp = json.timestamp || new Date().getTime();
    return blockHeader;
  }

  /**
   * Convert this block header to json
   */
  toJSON() {
    return {
      blockNumber: this.blockNumber,
      previousHash: this.previousHash,
      merkleRoot: this.merkleRoot,
      data: this.data.filter((tx) => tx.length > 0),
      sigR: this.sigR,
      sigS: this.sigS,
      sigV: this.sigV,
      timestamp: this.timestamp,
    }
  }
}

module.exports = BlockHeader;