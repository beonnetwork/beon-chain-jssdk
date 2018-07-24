'use strict';

const utils = require("./utils");

/**
 * UTXO
 */
class UTXO {
  /**
   * Create a UTXO
   * @param {number} blkNum block number
   * @param {number} txIndex transaction number
   * @param {number} oIndex output index
   * @param {string} owner owner address
   * @param {number} denom amount
   * @param {string} token token address
   */
  constructor(blkNum, txIndex, oIndex, owner, denom, token) {
    this.blkNum = +blkNum;
    this.txIndex = +txIndex;
    this.oIndex = +oIndex;
    this.owner = owner.toLowerCase();
    this.denom = +denom;
    if (!token || token == "0x0") {
      token = "0x0000000000000000000000000000000000000000";
    }
    this.token = (token || "0x0000000000000000000000000000000000000000").toLowerCase();
  }

  static fromJSON(json) {
    let {
      blkNum,
      txIndex,
      oIndex,
      owner,
      denom,
      token
    } = json;
    return new UTXO(blkNum, txIndex, oIndex, owner, denom, token);
  }

  toJSON() {
    return {
      blkNum: this.blkNum,
      txIndex: this.txIndex,
      oIndex: this.oIndex,
      owner: this.owner,
      token: this.token,
      denom: utils.numToStr(this.denom),
    }
  }
}

module.exports = UTXO;