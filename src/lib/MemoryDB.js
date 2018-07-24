'use strict'

const DB = require("./DB");
const Block = require("./Block");

/**
 * MemoryDB stores blocks in memory
 */
class MemoryDB extends DB {
  /**
   * Create MemoryDB
   * @param {Object} config configuration object
   */
  constructor(config) {
    super()
    this.blocks = []
    this.appendBlock(new Block(0, '2a5eed311ee07074f2396d20efbd59f4e9422b6ca486e71a97485e5203423cf2', []));
  }

  /**
   * Connect to the DB
   */
  async connect() {}

  /**
   * Append block to the chain, checking that it is linked correctly.
   * @param {Block} newBlock 
   */
  async appendBlock(newBlock) {
    //validate block
    let latestBlock = await this.getLatestBlock();
    if (latestBlock && latestBlock.hash != newBlock.blockHeader.previousHash) {
      return;
    }
    this.blocks.push(newBlock);
    return newBlock;
  }

  /**
   * Set confirmation signature
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   * @param {string} confirmSignature confirmation signature in hex string
   */
  async setConfirmSignature(blkNum, txIndex, confirmSignature) {
    let block = await this.getBlock(blkNum)
    block.confirmations[txIndex] = confirmSignature;
  }
  /**
   * Get the latest block
   */
  async getLatestBlock() {
    if (this.blocks.length == 0) {
      return;
    }
    return this.blocks[this.blocks.length - 1];
  }
  /**
   * Get all blocks
   */
  async getBlocks() {
    return this.blocks;
  }
  /**
   * Get block by number
   * @param {number} blockNumber block number
   */
  async getBlock(blockNumber) {
    let blocks = this.blocks.filter((block) => block.blockHeader.blockNumber == blockNumber)
    if (blocks.length > 0) {
      return blocks[0]
    }
    return;
  }
  /**
   * Get blocks in certain ranges
   * @param {number} fromBlockNumber from block number
   * @param {number} toBlockNumber to block number
   */
  async getBlocksInRange(fromBlockNumber, toBlockNumber) {
    let blocks = this.blocks.filter((block) => fromBlockNumber <= block.blockHeader.blockNumber && block.blockHeader.blockNumber <= toBlockNumber)
    return blocks
  }

  /**
   * Check if block already exists in the chain
   * @param {number} blockNumber 
   */
  async doesBlockExist(blockNumber) {
    let index = this.blocks.findIndex((block) => {
      return block.blockHeader.blockNumber == blockNumber;
    });
    return index >= 0;
  }

}

module.exports = MemoryDB;