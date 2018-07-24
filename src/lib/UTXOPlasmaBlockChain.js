'use strict';

const Web3 = require("web3");

const Block = require("./Block");
// const BlockHeader = require("./BlockHeader");
const Transaction = require("./Transaction");
const UTXO = require("./UTXO");
const RootChain = require("./RootChain");
const MemoryDB = require("./MemoryDB");

const utils = require("./utils");
const assert = require("assert");
/**
 * UTXOPlasmaBlockChain, a UTXO plasma chain 
 */
class UTXOPlasmaBlockChain {
  /**
   * Create UTXO plasma chain
   * @param {Object} config configuration object
   */
  constructor(config, DBClass = MemoryDB) {
    this.blockInterval = config.blockInterval || 100000;

    this.txPool = [];
    this.utxo = {};

    this.plasmaOperatorKey = config.plasmaOperatorKey;

    this.db = new DBClass(config);

    this.rootChain = new RootChain(config, this.db);
  }
  /**
   * Connect to the DB
   */
  async connect() {
    await this.db.connect();
    await this.rootChain.init();
    
    this.rootChain.startBlockSubmitter();

    // Replay UTXOs to restore the chain
    let blocks = await this.db.getBlocks();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      await this.db.processBlock(block);

      let blockNumber = block.blockHeader.blockNumber;
      let numTxs = block.transactions.length;
      for (let j = 0; j < numTxs; j++) {
        // console.log(blockNumber, j, block.blockHeader.merkle.getProof(j))
        const txData = block.transactions[j];
        const type = block.types[j];
        const tx = Transaction.fromTxData(txData, type);
        // console.log("tx.type", type, tx.txIndex1, tx.txIndex2)
        switch (tx.type) {
          case Transaction.TxType.DEPOSIT:
            // deposit
            console.log("[BOOTSTRAP]", "blockNumber, tx.blkNum1, tx.blkNum2", blockNumber, tx.blkNum1, tx.blkNum2)
            if (this.canCreateUTXO(blockNumber, tx, j)) {
              await this.createUTXO(blockNumber, tx, j);
            }
            break;
          case Transaction.TxType.MERGE:
            // merge
            console.log("[BOOTSTRAP] this.canSpendUTXO(tx)", this.canSpendUTXO(tx))
            console.log("[BOOTSTRAP] blockNumber, tx.blkNum1, tx.blkNum2", blockNumber, tx.blkNum1, tx.blkNum2)
            if (this.canSpendUTXO(tx) && this.canCreateUTXO(blockNumber, tx, j)) {
              await this.spendUTXO(tx);
              await this.createUTXO(blockNumber, tx, j);
            }
            break;
          case Transaction.TxType.WITHDRAW:
            // withdraw
            if (this.canSpendUTXO(tx)) {
              await this.spendUTXO(tx);
            }
            break;
          case Transaction.TxType.NORMAL:
            // spend
            if (this.canSpendUTXO(tx)) {
              await this.spendUTXO(tx);
            }
            // create
            if (this.canCreateUTXO(blockNumber, tx, j)) {
              await this.createUTXO(blockNumber, tx, j);
            }
            break;
          default:
            break;
        }
        // console.log("blockNumber", blockNumber, "utxo", this.utxo);
      }
    }
  }

  /**
   * Append block to the chain, checking that it is linked correctly.
   * @param {*} newBlock 
   */
  async appendBlock(newBlock) {
    return this.db.appendBlock(newBlock);
  }
  /**
   * Set confirmation signature
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   * @param {string} confirmSignature confirmation signature in hex string
   */
  async setConfirmSignature(blkNum, txIndex, confirmSignature) {
    await this.db.setConfirmSignature(blkNum, txIndex, confirmSignature);
  }

  /**
   * Get transaction proof in a block
   * @param {number} blockNumber block number
   * @param {number} txIndex transaction index
   */
  async getTransactionProofInBlock(blockNumber, txIndex) {
    let block = await this.db.getBlock(blockNumber);
    let tx = utils.addHexPrefix(block.transactions[txIndex]);
    let proof = block.blockHeader.merkle.getProof(txIndex);
    return {
      root: block.blockHeader.merkleRoot,
      tx: tx,
      proof: proof,
    };
  };

  /**
   * Get next block number
   */
  async getNextBlockNumber() {
    let previousBlock = await this.db.getLatestBlock();
    let blockNumber = previousBlock.blockHeader.blockNumber;
    return parseInt(blockNumber / 100000) * 100000 + this.blockInterval;
  }


  /**
   * Generate next block
   * @pre only one call at a time. 
   */
  async generateNextBlock() {
    if (this.generatingBlock) {
      return;
    }
    this.generatingBlock = true;
    let blockInterval = this.blockInterval;

    let previousBlock = await this.db.getLatestBlock();
    let previousHash = previousBlock.hash;
    let nextIndex = await this.getNextBlockNumber();

    // Query contract past event for deposits / withdrawals and collect transactions.
    let deposits = await this.rootChain.getDeposits(nextIndex - blockInterval);
    // TODO: filter out the one that already exists in the chain.
    // deposits = deposits.filter((deposit) => {
    //   return this.doesBlockExist(deposit.depositBlock)
    // })
    for (let i = deposits.length - 1; i >= 0; i--) {
      const deposit = deposits[i];
      let existed = await this.db.doesBlockExist(deposit.depositBlock)
      if (existed) {
        deposits.splice(i, 1);
      }
    }

    if (deposits.length > 0) {
      console.log(`${deposits.length} Deposit transactions found.`);

      const depositTxs = await this.createDepositTransactions(deposits);
      // console.log("depositTxs", depositTxs)
      for (let i = 0; i < depositTxs.length; i++) {
        const deposit = deposits[i];
        let dtxs = [];
        const tx = depositTxs[i];
        if (this.canCreateUTXO(deposit.depositBlock, tx, dtxs.length)) {
          await this.createUTXO(deposit.depositBlock, tx, dtxs.length);
          dtxs.push(tx);
        }

        if (!tx.newOwner1) {
          continue
        }
        const mergeTx = await this.createMergeTransaction(tx.newOwner1, tx.token);
        if (mergeTx !== null) {
          if (this.canSpendUTXO(mergeTx) && this.canCreateUTXO(deposit.depositBlock, mergeTx, dtxs.length)) {
            await this.spendUTXO(mergeTx);
            await this.createUTXO(deposit.depositBlock, mergeTx, dtxs.length);
            dtxs.push(mergeTx);
          }
        }

        let newBlock = new Block(deposit.depositBlock, previousHash, dtxs);

        let messageToSign = utils.addHexPrefix(newBlock.blockHeader.toString(false));
        let signature = this.rootChain.signBlock(messageToSign);
        newBlock.blockHeader.setSignature(signature);

        // console.log(newBlock.printBlock());
        newBlock = await this.appendBlock(newBlock).catch((e) => {
          console.log(e);
        });
        if (!newBlock) {
          continue;
        }
        console.log('New deposit block added.');

        dtxs.forEach(async (tx, i) => {
          let confirmSig = await this.generateConfirmSig(newBlock.blockHeader.blockNumber, i, this.plasmaOperatorKey);
          await this.setConfirmSignature(newBlock.blockHeader.blockNumber, i, confirmSig);
        });

        previousBlock = await this.db.getLatestBlock();

        assert(newBlock.hash == previousBlock.hash, "not equal");
        previousHash = previousBlock.hash;
      }
    }

    let withdrawals = await this.rootChain.getWithdrawals(nextIndex - blockInterval);
    let transactions = await this.collectTransactions(nextIndex, [], withdrawals);
    if (transactions.filter((tx) => tx != "").length == 0) {
      this.generatingBlock = false;
      return {};
    }

    let newBlock = new Block(nextIndex, previousHash, transactions);

    // Operator signs the new block.
    let messageToSign = utils.addHexPrefix(newBlock.blockHeader.toString(false));
    let signature = this.rootChain.signBlock(messageToSign);
    newBlock.blockHeader.setSignature(signature);

    // Submit the block header to plasma contract.
    let hexPrefixRoot = utils.addHexPrefix(newBlock.blockHeader.merkleRoot);
    this.rootChain.queueSubmitBlockHeader(nextIndex, hexPrefixRoot);

    // Add the new block to blockchain.
    // console.log(newBlock.printBlock());
    await this.appendBlock(newBlock);
    console.log('New block added.');

    // generate confirmation sigs for the tx that belongs to the operator.
    for (let i = 0; i < transactions.length; i++) {
      let tx = transactions[i];
      if (tx.type == Transaction.TxType.DEPOSIT || tx.type == Transaction.TxType.WITHDRAW || tx.type == Transaction.TxType.MERGE) {
        let confirmSig = await this.generateConfirmSig(newBlock.blockHeader.blockNumber, i, this.plasmaOperatorKey);
        await this.setConfirmSignature(newBlock.blockHeader.blockNumber, i, confirmSig);
      }
    }
    this.generatingBlock = false;
    return newBlock;
  }

  // UTXO and TxPool
  /**
   * Get pending transaction pool.
   */
  getTXPool() {
    return this.txPool;
  }
  /**
   * Get UTXOs
   */
  getUTXO() {
    return Object.values(this.utxo);
  }
  /**
   * Spend UTXO
   * @param {Transaction} tx transaction 
   */
  async spendUTXO(tx) {
    if (tx.blkNum1 !== 0) {
      const utxo = this.getUTXOByIndex(tx.blkNum1, tx.txIndex1, tx.oIndex1, tx.token);
      if (utxo) {
        delete this.utxo[this.getUTXOKey(tx.blkNum1, tx.txIndex1, tx.oIndex1, tx.token)];
        await this.db.spendUTXO(utxo);
      }
    }
    if (tx.blkNum2 !== 0) {
      const utxo = this.getUTXOByIndex(tx.blkNum2, tx.txIndex2, tx.oIndex2, tx.token);
      if (utxo) {
        delete this.utxo[this.getUTXOKey(tx.blkNum2, tx.txIndex2, tx.oIndex2, tx.token)];
        await this.db.spendUTXO(utxo);
      }
    }
  }
  /**
   * Check whether the transaction can be spent.
   * @param {Transaction} tx transaction
   */
  canSpendUTXO(tx) {
    let result1 = false;
    // console.log("tx.blkNum1", tx.blkNum1, typeof (tx.blkNum1))
    // console.log("tx.txIndex1", tx.txIndex1, typeof (tx.txIndex1))
    // console.log("tx.oIndex1", tx.oIndex1, typeof (tx.oIndex1))
    // console.log("tx.blkNum2", tx.blkNum2, typeof (tx.blkNum2))
    // console.log("tx.txIndex2", tx.txIndex2, typeof (tx.txIndex2))
    // console.log("tx.oIndex2", tx.oIndex2, typeof (tx.oIndex2))
    // console.log("tx.token", tx.token, typeof (tx.token))
    if (tx.blkNum1 !== 0) {
      const utxo = this.getUTXOByIndex(tx.blkNum1, tx.txIndex1, tx.oIndex1, tx.token);
      if (utxo) {
        result1 = true;
      } else {
        result1 = false;
      }
    } else {
      result1 = true;
    }
    let result2 = false;
    if (tx.blkNum2 !== 0) {
      const utxo = this.getUTXOByIndex(tx.blkNum2, tx.txIndex2, tx.oIndex2, tx.token);
      if (utxo) {
        result2 = true;
      } else {
        result2 = false;
      }
    } else {
      result2 = true;
    }
    console.log("result1, result2", result1, result2)
    return result1 && result2;
  }
  /**
   * Create UTXO
   * @param {number} blockNumber block number
   * @param {Transaction} tx a transaction object
   * @param {number} txIndex transaction index
   */
  async createUTXO(blockNumber, tx, txIndex) {
    // console.log(tx.newOwner2, tx.denom2)
    if (tx.newOwner1 !== 0 && tx.denom1 !== 0) {
      let utxo = new UTXO(blockNumber, txIndex, 0, tx.newOwner1, tx.denom1, tx.token)
      this.utxo[this.getUTXOKey(blockNumber, txIndex, 0, tx.token)] = utxo;
      await this.db.createUTXO(utxo);
    }
    // console.log(tx.newOwner2, tx.denom2)
    if (tx.newOwner2 !== 0 && tx.denom2 !== 0) {
      let utxo = new UTXO(blockNumber, txIndex, 1, tx.newOwner2, tx.denom2, tx.token)
      this.utxo[this.getUTXOKey(blockNumber, txIndex, 1, tx.token)] = utxo;
      await this.db.createUTXO(utxo);
    }
  }
  /**
   * Check whether this transaction can create a UTXO
   * @param {number} blockNumber block number
   * @param {Transaction} tx a transaction object
   * @param {number} txIndex transaction index
   */
  canCreateUTXO(blockNumber, tx, txIndex) {
    if (tx.newOwner1 !== 0 && tx.denom1 !== 0) {
      return true;
    }
    if (tx.newOwner2 !== 0 && tx.denom2 !== 0) {
      return true;
    }
    return false;
  }
  /**
   * Get UTXO by owner address
   * @param {string} owner hex string of owner address
   * @param {string} token hex string of token address
   * @param {number} [start=0] starting UTXO index to find
   */
  getUTXOByAddress(owner, token, start = 0) {
    if (!owner) {
      return;
    }
    if (!token || token == "0x0") {
      token = "0x0000000000000000000000000000000000000000"
    }
    let keys = Object.keys(this.utxo);
    for (let i = start; i < keys.length; i++) {
      let key = keys[i];
      if (this.utxo[key].owner.toLowerCase() === owner.toLowerCase() &&
        this.utxo[key].token.toLowerCase() === token.toLowerCase()) {
        return key;
      }
    }
    return;
  };

  /**
   * Get two UTXOs by address
   * @param {string} owner hex string of owner address
   * @param {string} token hex string of token address
   */
  getTwoUTXOsByAddress(owner, token) {
    if (!owner) {
      return [null, null];
    }
    if (!token || token == "0x0") {
      token = "0x0000000000000000000000000000000000000000"
    }
    let indexes = [];
    let keys = Object.keys(this.utxo);
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i];
      if (this.utxo[key].owner.toLowerCase() === owner.toLowerCase() &&
        this.utxo[key].token.toLowerCase() === token.toLowerCase()) {
        indexes.push(key);
        if (indexes.length == 2) {
          return indexes;
        }
      }
    }
    return [null, null];
  };

  getUTXOKey(blkNum, txIndex, oIndex, token) {
    return `${blkNum}:${txIndex}:${oIndex}:${token.toLowerCase()}`;
  }
  /**
   * Get UTXO by index
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   * @param {number} oIndex output index
   * @param {string} token hex string of token address
   */
  getUTXOByIndex(blkNum, txIndex, oIndex, token) {
    return this.utxo[this.getUTXOKey(blkNum, txIndex, oIndex, token)];
    // for (let i = 0; i < this.utxo.length; i++) {
    //   if (this.utxo[i].blkNum === blkNum &&
    //     this.utxo[i].txIndex === txIndex &&
    //     this.utxo[i].oIndex === oIndex &&
    //     this.utxo[i].token.toLowerCase() === token.toLowerCase()) {
    //     return i;
    //   }
    // }
    // return -1;
  };

  /**
   * Create a merge transaction to combine UTXO of the same owner and token
   * @param {string} owner hex string of owner address
   * @param {string} token hex string of token address
   */
  createMergeTransaction(owner, token) {
    const indexes = this.getTwoUTXOsByAddress(owner, token);

    if (indexes[0] && indexes[1]) {
      const utxoA = this.utxo[indexes[0]];
      const utxoB = this.utxo[indexes[1]];
      let tx = new Transaction(utxoA.blkNum, utxoA.txIndex, utxoA.oIndex, 0,
        utxoB.blkNum, utxoB.txIndex, utxoB.oIndex, 0,
        owner, utxoA.denom + utxoB.denom, 0, 0, 0,
        Transaction.TxType.MERGE, token);
      let signature = this.rootChain.signTransactionKey(tx.hash(), this.plasmaOperatorKey)
      tx.setSignature(signature);
      return tx;
    } else {
      return null;
    }
  };

  /**
   * Check whether the transaction is valid
   * @param {Transaction} tx transaction object
   */
  isValidTransaction(tx) {
    if (+tx.type !== Transaction.TxType.NORMAL) {
      return true;
    }

    let denom = 0;
    if (tx.blkNum1 !== 0) {
      let message = tx.hash();
      let utxo = this.getUTXOByIndex(tx.blkNum1, tx.txIndex1, tx.oIndex1, tx.token);
      if (utxo &&
        this.rootChain.isValidSignature(message, tx.sig1, utxo.owner)) {
        denom += utxo.denom;
      } else {
        return false;
      }
    }
    if (tx.blkNum2 !== 0) {
      let message = tx.hash();
      let utxo = this.getUTXOByIndex(tx.blkNum2, tx.txIndex2, tx.oIndex2, tx.token);
      if (utxo &&
        this.rootChain.isValidSignature(message, tx.sig2, utxo.owner)) {
        denom += utxo.denom;
      } else {
        return false;
      }
    }
    return denom === tx.denom1 + tx.denom2 + tx.fee;
  }

  /**
   * Get transaction hash, its merkle root and signature
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   */
  async getTxHashRoot(blkNum, txIndex) {
    let block = await this.db.getBlock(blkNum);
    let data = block.transactions[txIndex];
    // let rawData = utils.removeHexPrefix(data);
    // let txData = utils.addHexPrefix(rawData.slice(0, rawData.length - 130 - 130));
    // let sig1 = utils.addHexPrefix(rawData.slice(rawData.length - 130 - 130, rawData.length - 130));
    let {
      txBytes,
      sig1,
      sig2
    } = Block.splitTxData(data);
    console.log("txBytes", txBytes);
    let txHash = Web3.utils.sha3(txBytes);
    let root = utils.addHexPrefix(block.blockHeader.merkleRoot);
    return {
      txHash,
      root,
      sig1,
      sig2
    }
  }

  /**
   * Generate confirmation signature
   * @param {number} blkNum block number
   * @param {number} txIndex transaction index
   * @param {string} key hex string of the private key
   */
  async generateConfirmSig(blkNum, txIndex, key) {
    let data = await this.getTxHashRoot(blkNum, txIndex);
    let txHash = data.txHash;
    let root = data.root;
    let sig1 = data.sig1;
    let sig2 = data.sig2;
    let confirmSig1 = this.rootChain.confirmSig(txHash, root, key);
    let confirmSig2 = this.rootChain.confirmSig(txHash, root, key);
    if (this.rootChain.isValidConfirmSig(txHash, root, sig1, confirmSig1, sig2, confirmSig2)) {
      return utils.concatHex(confirmSig1, confirmSig2);
    } else {
      return "";
    }
  }

  /**
   * Create deposit transactions from deposit objects collected from deposit events
   * @param {Object[]} deposits deposit objects collected from deposit events
   */
  createDepositTransactions(deposits) {
    return deposits.map(deposit => {
      //console.log("deposit", deposit);
      const depositBlock = deposit.depositBlock;
      const owner = deposit.depositor;
      const amount = parseInt(deposit.amount);
      const token = deposit.token;
      let tx = new Transaction(depositBlock, 0, 0, 0, 0, 0, 0, 0,
        owner, amount, 0, 0, 0, Transaction.TxType.DEPOSIT, token);
      // console.log("tx.toString(false)", tx.toString(false));
      let signature = this.rootChain.signTransactionKey(tx.hash(), this.plasmaOperatorKey)
      tx.setSignature(signature);
      return tx;
    });
  };

  /**
   * Create withdrawal transactions from withdrawal objects collected from withdrawal events
   * @param {Object[]} withdrawals withdrawal objects collected from withdrawal events
   */
  createWithdrawalTransactions(withdrawals) {
    return withdrawals.map(withdrawal => {
      const utxoPos = withdrawal.utxoPos;
      const blkNum = parseInt(utxoPos / 1000000000);
      const txIndex = parseInt((utxoPos % 1000000000) / 10000);
      const oIndex = parseInt(utxoPos - blkNum * 1000000000 - txIndex * 10000);
      const token = withdrawal.token;
      let tx = new Transaction(blkNum, txIndex, oIndex, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, Transaction.TxType.WITHDRAW, token);
      let signature = this.rootChain.signTransactionKey(tx.hash(), this.plasmaOperatorKey)
      tx.setSignature(signature);
      return tx;
    });
  };

  /**
   * Collect all transactions
   * @param {number} blockNumber block number
   * @param {Transaction[]} deposits deposit transactions
   * @param {Transaction[]} withdrawals withdrawal transactions
   */
  async collectTransactions(blockNumber, deposits, withdrawals) {
    const txs = [];

    // if (deposits.length > 0) {
    //   console.log('Deposit transactions found.');
    //   console.log(deposits);
    //   const depositTxs = await this.createDepositTransactions(deposits);
    //   // console.log("depositTxs", depositTxs)
    //   for (let i = 0; i < depositTxs.length; i++) {
    //     const tx = depositTxs[i];
    //     this.createUTXO(blockNumber, tx, txs.length);
    //     txs.push(tx);

    //     if (!tx.newOwner1) {
    //       continue
    //     }
    //     const mergeTx = await this.createMergeTransaction(tx.newOwner1, tx.token);
    //     if (mergeTx !== null) {
    //       this.spendUTXO(mergeTx);
    //       this.createUTXO(blockNumber, mergeTx, txs.length);
    //       txs.push(mergeTx);
    //     }
    //   }
    // }

    if (withdrawals.length > 0) {
      console.log('Withdrawals detected.');
      console.log(withdrawals);
      const withdrawalTxs = await this.createWithdrawalTransactions(withdrawals);
      for (let i = 0; i < withdrawalTxs.length; i++) {
        const tx = withdrawalTxs[i];
        if (this.canSpendUTXO(tx)) {
          await this.spendUTXO(tx);
          txs.push(tx);
        }
      }
    }

    while (this.txPool.length > 0) {
      const tx = this.txPool[0];
      if (this.canCreateUTXO(blockNumber, tx, txs.length)) {
        await this.createUTXO(blockNumber, tx, txs.length);
        txs.push(tx);
        this.txPool.shift();
      }

      const mergeTx1 = await this.createMergeTransaction(tx.newOwner1, tx.token);
      if (mergeTx1 !== null) {
        if (this.canSpendUTXO(mergeTx1) && this.canCreateUTXO(blockNumber, mergeTx1, txs.length)) {
          await this.spendUTXO(mergeTx1);
          await this.createUTXO(blockNumber, mergeTx1, txs.length);
          txs.push(mergeTx1);
        }
      }
      const mergeTx2 = await this.createMergeTransaction(tx.newOwner2, tx.token);
      if (mergeTx2 !== null) {
        if (this.canSpendUTXO(mergeTx2) && this.canCreateUTXO(blockNumber, mergeTx2, txs.length)) {
          await this.spendUTXO(mergeTx2);
          await this.createUTXO(blockNumber, mergeTx2, txs.length);
          txs.push(mergeTx2);
        }
      }

      // Limit transactions per block to power of 2 on purpose for the
      // convenience of building Merkle tree.
      if (txs.length >= 256) {
        break;
      }
    }

    // Fill empty string if transactions are less than 256.
    const len = txs.length;
    for (let i = len; i < 256; i++) {
      txs.push("");
    }
    return txs;
  }

  /**
   * Create an unsigned transaction
   * @param {string} token hex string of token address
   * @param {string} from hex string of from address
   * @param {string} to hex string of to address
   * @param {number} amount the amount to transfer
   * @param {string} [confirmSig] the confirmation signature
   */
  async createUnsignedTransaction(token, from, to, amount, confirmSig) {
    let index = this.getUTXOByAddress(from, token);
    if (!index) {
      throw 'No asset found';
    }
    let utxo = this.utxo[index];
    let blkNum1 = utxo.blkNum;
    let txIndex1 = utxo.txIndex;
    let oIndex1 = utxo.oIndex;

    let block = await this.db.getBlock(blkNum1)
    let txHashRoot = await this.getTxHashRoot(blkNum1, txIndex1);
    let txHash = txHashRoot.txHash;
    let root = txHashRoot.root;
    let sig1 = txHashRoot.sig1;
    let sig2 = txHashRoot.sig2;
    confirmSig = confirmSig || block.confirmations[txIndex1] || "";
    console.log("confirmSig", confirmSig);
    // try generating confirmation signature
    let {
      confirmSig1,
      confirmSig2
    } = utils.splitConfirmSig(confirmSig);
    if (!confirmSig || !(this.rootChain.isValidConfirmSig(txHash, root, sig1, confirmSig1, sig2, confirmSig2))) {
      throw 'Invalid confirmation signature';
    }
    this.setConfirmSignature(blkNum1, txIndex1, confirmSig);

    let newOwner1 = to;
    let denom1 = Web3.utils.toWei("" + amount, "ether");
    let fee = Web3.utils.toWei("" + 0.00, "ether"); // hard-coded fee to 0
    if (+utxo.denom < +denom1 + +fee) {
      throw 'Insufficient funds';
    }
    let remain = +utxo.denom - +denom1 - +fee;
    let newOwner2 = (remain > 0) ? from : 0;
    let denom2 = remain;

    let tx = new Transaction(
      blkNum1, txIndex1, oIndex1, 0, 0, 0, 0, 0,
      newOwner1, denom1, newOwner2, denom2, fee, Transaction.TxType.NORMAL);

    return tx;
  }

  /**
   * Create a transaction
   * @param {string} token hex string of token address
   * @param {string} from hex string of from address
   * @param {string} to hex string of to address
   * @param {number} amount the amount to transfer
   * @param {string} [confirmSig] the confirmation signature
   * @param {string} key the hex string of the private key
   */
  async createTransaction(token, from, to, amount, confirmSig, key) {
    let index = this.getUTXOByAddress(from, token);
    if (!index) {
      throw 'No asset found';
    }
    let utxo = this.utxo[index];
    let blkNum1 = utxo.blkNum;
    let txIndex1 = utxo.txIndex;
    let oIndex1 = utxo.oIndex;

    let block = await this.db.getBlock(blkNum1)
    let txHashRoot = await this.getTxHashRoot(blkNum1, txIndex1);
    let txHash = txHashRoot.txHash;
    let root = txHashRoot.root;
    let sig1 = txHashRoot.sig1;
    let sig2 = txHashRoot.sig2;
    confirmSig = confirmSig || block.confirmations[txIndex1] || "";
    // try generating confirmation signature
    if (!confirmSig) {
      confirmSig = await this.generateConfirmSig(blkNum1, txIndex1, key)
    }
    let {
      confirmSig1,
      confirmSig2
    } = utils.splitConfirmSig(confirmSig);
    if (!confirmSig || !(this.rootChain.isValidConfirmSig(txHash, root, sig1, confirmSig1, sig2, confirmSig2))) {
      throw 'Invalid confirmation signature';
    }
    this.setConfirmSignature(blkNum1, txIndex1, confirmSig);

    let newOwner1 = to;
    let denom1 = Web3.utils.toWei("" + amount, "ether");
    let fee = Web3.utils.toWei("" + 0.00, "ether"); // hard-coded fee to 0
    if (+utxo.denom < +denom1 + +fee) {
      throw 'Insufficient funds';
    }
    let remain = +utxo.denom - +denom1 - +fee;
    let newOwner2 = (remain > 0) ? from : 0;
    let denom2 = remain;

    let tx = new Transaction(
      blkNum1, txIndex1, oIndex1, 0, 0, 0, 0, 0,
      newOwner1, denom1, newOwner2, denom2, fee, Transaction.TxType.NORMAL);
    let signature = this.rootChain.signTransactionKey(tx.hash(), key);
    tx.setSignature(signature);

    return this.submitTransaction(tx);
  }

  /**
   * Submit Transaction
   * @param {Transaction} tx a transaction object
   * @param {string} confirmSig a confirmation signature
   */
  async submitTransaction(tx, confirmSig) {
    let blkNum1 = tx.blkNum1;
    let txIndex1 = tx.txIndex1;
    let block = await this.db.getBlock(blkNum1)
    let txHashRoot = await this.getTxHashRoot(blkNum1, txIndex1);
    let txHash = txHashRoot.txHash;
    let root = txHashRoot.root;
    let sig1 = txHashRoot.sig1;
    let sig2 = txHashRoot.sig2;
    confirmSig = confirmSig || block.confirmations[txIndex1] || "";

    // TODO: check pending transactions < 256 txs
    let nextBlockNumber = await this.getNextBlockNumber();
    // console.log("confirmSig, nextBlockNumber", confirmSig, nextBlockNumber)
    if (blkNum1 >= nextBlockNumber) {
      console.log("Block has yet been included");
      throw 'Block has yet been included';
    }
    // try generating confirmation signature
    // if (!confirmSig) {
    //   confirmSig = await this.generateConfirmSig(blkNum1, txIndex1, key)
    // }
    // if (!confirmSig || !(this.rootChain.isValidConfirmSig(txHash, root, sig1, confirmSig))) {
    //   throw 'Invalid confirmation signature';
    // }
    let {
      confirmSig1,
      confirmSig2
    } = utils.splitConfirmSig(confirmSig);
    if (!confirmSig || !(this.rootChain.isValidConfirmSig(txHash, root, sig1, confirmSig1, sig2, confirmSig2))) {
      throw 'Invalid confirmation signature';
    }
    this.setConfirmSignature(blkNum1, txIndex1, confirmSig);

    // console.log("this.isValidTransaction(tx)", this.isValidTransaction(tx))
    // console.log("this.canSpendUTXO(tx)", this.canSpendUTXO(tx))
    if (this.isValidTransaction(tx) && this.canSpendUTXO(tx)) {
      await this.spendUTXO(tx);
      this.txPool.push(tx);
    } else {
      console.log("Invalid transaction");

      throw 'Invalid transaction';
    }
    return tx;
  }
}

module.exports = UTXOPlasmaBlockChain;