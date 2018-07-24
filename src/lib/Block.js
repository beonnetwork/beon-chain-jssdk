'use strict';

const BlockHeader = require('./BlockHeader');
const utils = require("./utils");
const Web3 = require("web3");

/**
 * Block
 */
class Block {
  /**
   * Split transaction data into txBytes, sig1, sig2
   * @param {string} txData hex string of data to split into txBytes, sig1, sig2
   */
  static splitTxData(txData) {
    let rawData = utils.removeHexPrefix(txData);
    let txBytes = utils.addHexPrefix(rawData.slice(0, rawData.length - 130 - 130));
    let sig1 = utils.addHexPrefix(rawData.slice(rawData.length - 130 - 130, rawData.length - 130));
    let sig2 = utils.addHexPrefix(rawData.slice(rawData.length - 130));
    return {
      txBytes,
      sig1,
      sig2,
    }
  }

  /**
   * Create a block
   * @param {number} blockNumber block number
   * @param {string} previousHash hex string of hash of previous block
   * @param {Transaction[]} transactions array of transactions
   */
  constructor(blockNumber, previousHash, transactions) {
    previousHash = utils.addHexPrefix(previousHash);
    let merkleData = [];
    transactions = transactions || [];
    transactions.forEach(tx => {
      //console.log(tx, tx.merkleData);
      if (tx && tx.merkleData) {
        merkleData.push(tx.merkleData());
      } else {
        merkleData.push(tx);
      }
    });
    this.blockHeader = new BlockHeader(blockNumber, previousHash, merkleData);
    this.transactions = transactions.map(tx => tx && tx.data ? tx.data() : tx).filter(tx => tx.length > 0);
    this.hashes = this.transactions.map(tx => Web3.utils.sha3(tx));
    this.confirmations = transactions.map(tx => "").filter(tx => tx.length > 0);
    this.types = transactions.map(tx => tx.type).filter(t => t != null);
  }

  /**
   * Sha3 hash of the hex string representing transactions in this block
   */
  get hash() {
    return Web3.utils.sha3(utils.addHexPrefix(this.toString()));
  }

  /**
   * Convert block to hex string of transactions without the prefix.
   */
  toString() {
    let txsHex = "";
    this.transactions.forEach(tx => txsHex += utils.removeHexPrefix(tx));
    this.types.forEach(tx => txsHex += tx);
    return this.blockHeader.toString(true) + txsHex;
  }

  /**
   * Create a block from json
   * @param {Object} json json string from toJSON()
   */
  static fromJSON(json) {
    let block = new Block(json.blockNumber, json.previousHash);
    block.transactions = json.transactions;
    block.confirmations = json.confirmations;
    block.types = json.types;
    block.hashes = json.hashes;
    block.blockHeader = BlockHeader.fromJSON(json.blockHeader);
    return block;
  }

  /**
   * Get Transaction in block
   */
  getTransactions() {
    let txs = [];
    for (let i = 0; i < this.transactions.length; i++) {
      const txData = this.transactions[i];
      let type = this.types[i] ? this.types[i] : 0;
      const tx = Transaction.fromTxData(txData, type);
      txs.push(tx);
    }
    return txs;
  }

  /**
   * Convert a block to JSON
   */
  toJSON() {
    // console.log(this, this.blockHeader);
    return {
      'blockHeader': this.blockHeader.toJSON(),
      'hashes': this.hashes.filter(tx => tx && tx.length > 0),
      'transactions': this.transactions.filter(tx => tx && tx.length > 0),
      'confirmations': this.confirmations.filter(cf => cf && cf.length > 0),
      'types': this.types.filter(t => t != null),
    }
  }

  /**
   * Returns a simplified json object representing a block
   */
  printBlock() {
    return {
      'blockNumber': this.blockHeader.blockNumber,
      'previousHash': this.blockHeader.previousHash,
      'merkleRoot': this.blockHeader.merkleRoot,
      'signature': utils.addHexPrefix(this.blockHeader.sigR + this.blockHeader.sigS + this.blockHeader.sigV),
      'transactions': this.transactions.filter(tx => tx && tx.length > 0),
      'hashes': this.hashes.filter(tx => tx && tx.length > 0),
      'confirmations': this.confirmations.filter(cf => cf && cf.length > 0),
      'types': this.types.filter(t => t != null),
      'timestamp': this.blockHeader.timestamp,
    };
  }
}

module.exports = Block;