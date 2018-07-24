'use strict'

class DB {
  async connect(){
    throw "Not yet implemented"
  }
  async appendBlock(newBlock) {
    throw "Not yet implemented"
  }
  async setConfirmSignature(blkNum, txIndex, confirmSignature) {
    throw "Not yet implemented"
  }
  async getLatestBlock() {
    throw "Not yet implemented"
  }
  async getBlocks() {
    throw "Not yet implemented"
  }
  async getBlock(blockNumber) {
    throw "Not yet implemented"
  }
  async getBlocksInRange(fromBlockNumber, toBlockNumber) {
    throw "Not yet implemented"
  }
  async doesBlockExist(blockNumber) {
    throw "Not yet implemented"
  }
}

module.exports = DB;