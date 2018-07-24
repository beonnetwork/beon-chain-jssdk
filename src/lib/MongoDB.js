'use strict'

const MongoClient = require('mongodb').MongoClient;

const Block = require('./Block');
const Transaction = require('./Transaction');
const UTXO = require('./UTXO');
const Web3 = require('web3');

const DB = require('./DB');

class MongoDB extends DB {
  constructor(config) {
    super()
    this.config = config;
  }
  async connect() {
    let config = this.config;
    let client = await MongoClient.connect(config.mongodbURL).catch((e) => {
      throw "Cannot connect to the database";
    })

    console.log("connected successfully to the database");
    this.client = client;
    this.db = client.db(config.mongodbDBName);
    this.utxos = this.db.collection('utxos');
    this.utxos.ensureIndex({
      "owner": 1
    });

    this.utxos.ensureIndex({
      blkNum: 1,
      txIndex: 1,
      oIndex: 1,
      owner: 1,
      token: 1,
    }, {
      unique: true
    });


    this.transactions = this.db.collection('transactions');
    this.transactions.ensureIndex({
      "hash": 1
    }, {
      unique: true
    });
    this.blocks = this.db.collection('blocks');
    this.blocks.ensureIndex({
      "blockHeader.blockNumber": -1
    }, {
      unique: true
    });
    if (!await this.getLatestBlock()) {
      let genesis = new Block(0, '2a5eed311ee07074f2396d20efbd59f4e9422b6ca486e71a97485e5203423cf2', []);
      await this.blocks.insertOne(genesis.toJSON()).catch(e => {
        throw "Cannot insert genesis block"
      });
    }
  }
  async processBlock(newBlock) {
    let txs = [];
    for (let i = 0; i < newBlock.transactions.length; i++) {
      const txData = newBlock.transactions[i];
      const type = newBlock.types[i];
      let tx = Transaction.fromTxData(txData, type);
      txs.push(tx.toJSON());
    }
    console.log(txs);
    if (txs.length > 0) {
      let result = await this.transactions.insertMany(txs, {
        ordered: false
      }).catch((e) => {
        console.log("Cannot insert tx, tx may exists already");
      });
      console.log(result ? result.insertedCount : '')
    }
  }
  /**
   * Append block to the chain, checking that it is linked correctly.
   * @param {*} newBlock 
   */
  async appendBlock(newBlock) {
    //validate block
    let latestBlock = await this.getLatestBlock();
    if (latestBlock && latestBlock.hash != newBlock.blockHeader.previousHash) {
      throw "Trying to append an incorrect block, previous hash does not match the earlier block"
    }

    await this.blocks.insertOne(newBlock.toJSON(), {}).catch((e) => {
      throw "Cannot insert block, block may exists already";
    });

    await this.processBlock(newBlock);

    return newBlock;
  }
  /**
   * Set confirmation signature
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   * @param {string} confirmSignature confirmation signature in hex string
   */
  async setConfirmSignature(blkNum, txIndex, confirmSignature) {
    blkNum = +blkNum;
    txIndex = +txIndex;
    let update = {}
    update[`confirmations.${txIndex}`] = confirmSignature
    await this.blocks.updateOne({
      "blockHeader.blockNumber": blkNum
    }, {
      $set: update
    })
  }
  /**
   * Get the latest block
   */
  async getLatestBlock() {
    let blockJSON = await this.blocks.findOne({}, {
      sort: {
        "blockHeader.blockNumber": -1
      }
    })
    if (!blockJSON) {
      return;
    }
    return Block.fromJSON(blockJSON);
  }
  /**
   * Get all blocks
   */
  async getBlocks(ascending = true) {
    let blockJSONs = await this.blocks.find({}, {
      sort: {
        "blockHeader.blockNumber": ascending ? 1 : -1
      }
    }).toArray();
    return blockJSONs.map(blockJSON => Block.fromJSON(blockJSON));
  }
  /**
   * Get block by number
   * @param {number} blockNumber block number
   */
  async getBlock(blockNumber) {
    let blockJSON = await this.blocks.findOne({
      "blockHeader.blockNumber": +blockNumber
    }, {})
    if (blockJSON) {
      return Block.fromJSON(blockJSON);
    } else {
      return;
    }
  }
  /**
   * Get blocks in certain ranges
   * @param {number} fromBlockNumber from block number
   * @param {number} toBlockNumber to block number
   */
  async getBlocksInRange(fromBlockNumber, toBlockNumber) {
    let query = {};
    if (fromBlockNumber) {
      query["$gte"] = fromBlockNumber;
    }
    if (toBlockNumber) {
      query["$lte"] = toBlockNumber;
    }
    let blockJSONs = await this.blocks.find({
      "blockHeader.blockNumber": query
    }, {}).toArray();
    return blockJSONs.map(blockJSON => Block.fromJSON(blockJSON));
  }
  /**
   * Check if block already exists in the chain
   * @param {number} blockNumber 
   */
  async doesBlockExist(blockNumber) {
    let blockJSON = await this.blocks.findOne({
      "blockHeader.blockNumber": +blockNumber
    }, {})
    if (blockJSON) {
      return true;
    } else {
      return false;
    }
  }
  async getBlockByTxHash(hash) {
    let json = await this.blocks.findOne({
      "hashes": hash
    }, {})
    if (json) {
      return Block.fromJSON(json);
    } else {
      return;
    }
  }
  async getUnconfirmedConfirmationHashes(address) {
    address = address.toLowerCase();
    let blockJSONs = await this.blocks.find({
      "confirmations": null
    }, {}).toArray();
    let hashes = [];
    let blocks = blockJSONs.map(blockJSON => UTXO.fromJSON(blockJSON));
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      for (let j = 0; j < block.confirmations.length; j++) {
        const confirmation = block.confirmations[j];
        const transaction = block.transactions[j];
        const type = block.types[j];
        let tx = Transaction.fromTxData(transaction, type);
        let utxo1 = this.getUTXO(tx.blkNum1, tx.txIndex1, tx.oIndex1);
        let utxo2 = this.getUTXO(tx.blkNum2, tx.txIndex2, tx.oIndex2);
        if (!confirmation && (utxo1.owner.toLowerCase() === address || utxo2.owner.toLowerCase() === address)) {
          let root = utils.addHexPrefix(block.blockHeader.merkleRoot);
          let confirmationHash = Web3.utils.soliditySha3(tx.hash(), root);
          let blkNum, txIndex;
          if (utxo1.owner.toLowerCase() === address) {
            blkNum = tx.blkNum1;
            txIndex = tx.txIndex1;
          } else if (utxo2.owner.toLowerCase() === address) {
            blkNum = tx.blkNum2;
            txIndex = tx.txIndex2;
          }
          hashes.push({
            blkNum,
            txIndex,
            confirmationHash
          });
        }
      }
    }
    return hashes;
  }
  async getUnconfirmedTransactions(address) {
    address = address.toLowerCase();
    let blockJSONs = await this.blocks.find({
      "confirmations": null
    }, {}).toArray();
    let txs = [];
    let blocks = blockJSONs.map(blockJSON => UTXO.fromJSON(blockJSON));
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      for (let j = 0; j < block.confirmations.length; j++) {
        const confirmation = block.confirmations[j];
        const transaction = block.transactions[j];
        const type = block.types[j];
        let tx = Transaction.fromTxData(transaction, type);
        let utxo1 = this.getUTXO(tx.blkNum1, tx.txIndex1, tx.oIndex1);
        let utxo2 = this.getUTXO(tx.blkNum2, tx.txIndex2, tx.oIndex2);
        if (!confirmation && (utxo1.owner.toLowerCase() === address || utxo2.owner.toLowerCase() === address)) {
          let tx = Transaction.fromTxData(transaction, type);
          txs.push(tx);
        }
      }
    }
    return txs;
  }
  async getTxByHash(hash) {
    let json = await this.transactions.findOne({
      "hash": hash
    }, {})
    if (json) {
      return Transaction.fromJSON(json);
    } else {
      return;
    }
  }
  async getUTXO(blkNum, txIndex, oIndex) {
    let utxoJSON = await this.utxos.findOne({
      blkNum,
      txIndex,
      oIndex
    }, {});
    console.log("utxoJSON", utxoJSON);
    if (utxoJSON) {
      return UTXO.fromJSON(utxoJSON);
    } else {
      return;
    }
  }
  async getUTXOsByAddress(owner) {
    let utxoJSONs = await this.utxos.find({
      "owner": owner,
      "spent": {
        $ne: true
      }
    }, {}).toArray();
    return utxoJSONs.map(utxoJSON => UTXO.fromJSON(utxoJSON));
  }
  async createUTXO(utxo) {
    let result = await this.utxos.insertOne(utxo.toJSON(), {}).catch(e => {
      console.log("Cannot insert UTXO", e.message);
      // throw "Cannot insert UTXO"
    });
    // console.log("createOne", utxo.toJSON(), result ? result.insertedCount : '');
  }
  async spendUTXO(utxo) {
    let utxoJSON = utxo.toJSON();
    delete utxoJSON.denom;
    let result = await this.utxos.findOneAndUpdate(utxoJSON, {
      "$set": {
        spent: true
      }
    }).catch(e => {
      console.log("Cannot delete UTXO", e.message);
      // throw "Cannot delete UTXO"
    });
    // console.log("deleteOne", utxo.toJSON(), result.deletedCount);
  }

  async getPendingTxsByAddress(address) {

  }
  async getPendingExitsByAddress(address) {

  }
}

module.exports = MongoDB;