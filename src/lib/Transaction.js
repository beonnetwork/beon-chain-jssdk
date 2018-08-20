'use strict';

const RLP = require('rlp');
const Web3 = require('web3');
const Block = require('./Block');
const utils = require("./utils");
const BN = Web3.utils.BN;
const isBN = Web3.utils.isBN;

/**
 * Transaction
 */
class Transaction {

  /**
   * Enum for transaction types
   * @readonly
   * @type {TxType}
   * @enum {number}
   */
  static get TxType() {
    return {
      NORMAL: 0,
      DEPOSIT: 1,
      WITHDRAW: 2,
      MERGE: 3
    };
  }

  /**
   * Create a Transaction
   * @param {number} blkNum1 block number 1
   * @param {number} txIndex1 transaction number 1 
   * @param {number} oIndex1 output index 1
   * @param {string} sig1 signature 1
   * @param {number} blkNum2 block number 2
   * @param {number} txIndex2 transaction number 2
   * @param {number} oIndex2 output index 2
   * @param {string} sig2 signature 2
   * @param {string} newOwner1 new owner 1
   * @param {string} denom1 amount 1 
   * @param {string} newOwner2 new owner 2
   * @param {string} denom2 amount 2
   * @param {string} fee fee
   * @param {TxType} type type of transaction
   * @param {string} token token address
   */
  constructor(blkNum1, txIndex1, oIndex1, sig1,
    blkNum2, txIndex2, oIndex2, sig2,
    newOwner1, denom1, newOwner2, denom2, fee, type, token) {
    // first input
    this.blkNum1 = +blkNum1;
    this.txIndex1 = +txIndex1;
    this.oIndex1 = +oIndex1;
    this.sig1 = sig1 || "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    // second input
    this.blkNum2 = +blkNum2;
    this.txIndex2 = +txIndex2;
    this.oIndex2 = +oIndex2;
    this.sig2 = sig2 || "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    // outputs
    this.newOwner1 = newOwner1 ? newOwner1.toLowerCase() : newOwner1;
    this.denom1 = isBN(denom1) ? denom1 : new BN(""+denom1);
    this.newOwner2 = newOwner2 ? newOwner2.toLowerCase() : newOwner2;
    this.denom2 = isBN(denom2) ? denom2 : new BN(""+denom2);
    this.fee = isBN(fee) ? fee : new BN(""+fee);

    this.type = type;
    if (!token || token == "0x0") {
      token = "0x0000000000000000000000000000000000000000";
    }
    this.token = (token || "0x0000000000000000000000000000000000000000").toLowerCase();
    this.timestamp = new Date().getTime();
  }

  /**
   * 
   * @param {*} includingSig 
   */
  encode(includingSig) {
    let data = [
      this.blkNum1, this.txIndex1, this.oIndex1,
      this.blkNum2, this.txIndex2, this.oIndex2,
      this.newOwner1, this.denom1, this.newOwner2, this.denom2, this.fee, this.token
    ];
    if (includingSig) {
      data.push(this.sig1);
      data.push(this.sig2);
    }
    return RLP.encode(data);
  }

  /**
   * 
   * @param {*} includingSig 
   */
  toString(includingSig) {
    return utils.bufferToHex(this.encode(includingSig), false);
  }

  /**
   * 
   */
  hash() {
    return Web3.utils.sha3(utils.addHexPrefix(this.toString(false)));
  }

  /**
   * 
   */
  data() {
    return utils.concatHex(this.toString(false), this.sig1, this.sig2);
  }

  /**
   * 
   */
  merkleData() {
    return utils.concatHex(this.hash(), this.sig1, this.sig2);
  }

  /**
   * 
   */
  merkleHash() {
    return Web3.utils.sha3(this.merkleData())
  }

  /**
   * 
   * @param {*} json 
   */
  static fromJSON(json) {    
    let tx = new Transaction(
      json.blkNum1,
      json.txIndex1,
      json.oIndex1,
      json.sig1,
      json.blkNum2,
      json.txIndex2,
      json.oIndex2,
      json.sig2,
      json.newOwner1,
      json.denom1,
      json.newOwner2,
      json.denom2,
      json.fee,
      json.type,
      json.token,
    );
    tx.timestamp = json.timestamp || new Date().getTime();
    return tx;
  }

  static fromTxData(txData, type) {
    let {
      txBytes,
      sig1,
      sig2
    } = Block.splitTxData(txData);
    let data = RLP.decode(txBytes);
    data = data.map((datum, i) => {
      datum = utils.removeHexPrefix(utils.bufferToHex(datum));
      if (datum) {
        if (i == 6 || i == 8 || i == 11) {
          return utils.addHexPrefix(datum);
        }
        return utils.hexToNumberString(utils.addHexPrefix(datum));
      } else {
        return 0;
      }
    });

    let tx = new Transaction(data[0], data[1], data[2], sig1, data[3], data[4], data[5], sig2, data[6], data[7], data[8], data[9], data[10], type, data[11]);
    return tx;
  }

  /**
   * 
   */
  toJSON() {
    return {
      blkNum1: this.blkNum1,
      txIndex1: this.txIndex1,
      oIndex1: this.oIndex1,
      sig1: this.sig1,
      blkNum2: this.blkNum2,
      txIndex2: this.txIndex2,
      oIndex2: this.oIndex2,
      sig2: this.sig2,
      newOwner1: this.newOwner1,
      denom1: this.denom1.toString(),
      newOwner2: this.newOwner2,
      denom2: this.denom2.toString(),
      fee: this.fee.toString(),
      type: this.type,
      token: this.token,
      timestamp: this.timestamp,
      hash: Web3.utils.sha3(this.data()),
    }
  }

  /**
   * Set signature of the transaction
   * @param {*} sig1 
   * @param {*} sig2 
   */
  setSignature(sig1, sig2) {
    this.sig1 = sig1 || "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    if (this.blkNum2 !== 0) {
      this.sig2 = sig2 || sig1 || "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    }
  }

}

module.exports = Transaction;