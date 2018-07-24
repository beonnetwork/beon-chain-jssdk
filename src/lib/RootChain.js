'use strict';

const Web3 = require("web3");

// const config = require("./config");
const utils = require("./utils");
const Block = require("./Block");
const Transaction = require("./Transaction");

/**
 * RootChain interacting with the Ethereum network
 */
class RootChain {
  /**
   * Create a RootChain to interact with Ethereum root chain
   * @param {Object} config configuration object
   */
  constructor(config, db) {
    if (!config.artifacts) {
      throw "Artifacts path is not specified"
    }
    this.config = config;
    this.db = db;
    // this.init(config, db);
  }

  async init() {
    let config = this.config;
    let db = this.db;
    let artifacts = config.artifacts;
    let provider = config.provider || new Web3.providers.HttpProvider('http://localhost:7545');
    this.web3 = new Web3(provider);
    let block = await this.web3.eth.getBlock("latest");
    this.gasLimit = block.gasLimit;
    this.plasmaContract = new this.web3.eth.Contract(artifacts.abi, config.plasmaContractAddress, {
      gas: this.gasLimit
    });
    this.config = config;
    // this.queue = [];

    // TODO: move to DB
    this.status = {};
    this.db = db;
    // this.startBlockSubmitter();

    this.alreadyDeposit = {};
  }

  /**
   * Start block submitter, checking to see block header in the queue and then append to the chain
   */
  async startBlockSubmitter() {
    let running = false;
    setInterval(async () => {
      if (running) {
        return;
      }
      running = true;
      let currentBlk = await this.plasmaContract.methods.getCurrentChildBlock().call();
      currentBlk = +currentBlk;

      // Submit unsubmitted blocks
      let blocks = await this.db.getBlocksInRange(currentBlk);
      blocks = blocks.sort((a, b) => +a.blockHeader.blockNumber > +b.blockHeader.blockNumber);
      console.log("currentBlk", currentBlk, blocks.length);

      if (blocks.length > 0) {
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          let blkNum = block.blockHeader.blockNumber;
          let root = block.blockHeader.merkleRoot;
          let promiEventObj = await this.submitBlockHeader(blkNum, root).catch((err) => {
            console.error("error", err);
          });
          if (!promiEventObj) {
            continue;
          }
          let result = await promiEventObj.promiEvent.catch((err) => {
            console.error("error submitting block header", err);
          });
        }
      }
      running = false;

      // if (this.queue.length == 0) {
      //   return;
      // }
      // let args = this.queue[0];
      // let blkNum = args[0];
      // let root = args[1];
      // let promiEventObj = await this.submitBlockHeader(blkNum, root).catch((err) => {
      //   console.error(err);
      // });
      // if (!promiEventObj) {
      //   return;
      // }
      // promiEventObj.promiEvent.on('confirmation', (confNumber, receipt) => {
      //   this.status[blkNum] = {
      //     confNumber,
      //     receipt
      //   }
      // });
      // let result = await promiEventObj.promiEvent.catch((err) => {
      //   console.error("error submitting block header", err);
      // });
      // if (result && result.status) {
      //   this.queue.shift();
      // }
    }, 1000);
  }

  /**
   * Queue block header to be submit
   * @param {number} blkNum block nubmer
   * @param {string} header merkle root hex string
   */
  queueSubmitBlockHeader(blkNum, header) {
    // this.queue.push([blkNum, header]);
  }

  /**
   * Submit block header
   * @param {number} blkNum block nubmer
   * @param {string} header merkle root hex string
   */
  async submitBlockHeader(blkNum, header) {
    let currentBlk = await this.plasmaContract.methods.getCurrentChildBlock().call();
    if (currentBlk != blkNum) {
      throw `Out of sync, rootChain(${currentBlk}) and childChain(${blkNum}) are out of sync`;
    }
    let result = await this.web3.eth.accounts.signTransaction({
      from: this.config.plasmaOperatorAddress,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.submitBlock(blkNum, header).encodeABI(),
    }, this.config.plasmaOperatorKey);
    let promiEvent = this.web3.eth.sendSignedTransaction(result.rawTransaction)
    return {
      promiEvent
    };
  };

  /**
   * Sign a block
   * @param {string} message hex string of the message
   */
  signBlock(message) {
    return this.web3.eth.accounts.sign(message, this.config.plasmaOperatorKey).signature;
  };

  /**
   * Sign a transaction with Key
   * @param {string} message hex string of the message
   * @param {string} key hex string of the private key
   */
  signTransactionKey(message, key) {
    // const hash = this.web3.eth.accounts.hashMessage(message);
    return this.web3.eth.accounts.sign(message, key).signature;
  };

  /**
   * Check whether a signature is valid
   * @param {string} message hex string of the message
   * @param {string} signature hex string of the signature
   * @param {string} address hex string of the address
   */
  isValidSignature(message, signature, address) {
    // const hash = await this.web3.eth.accounts.hashMessage(message);
    // TODO: normalize signing and recovery from different ways
    // let signer1 = utils.ecRecover(message, signature);
    console.log("message, signature", message, signature)
    let signer2 = this.web3.eth.accounts.recover(message, signature);
    // return utils.removeHexPrefix(address.toLowerCase()) == utils.removeHexPrefix(signer1.toLowerCase()) || 
    return utils.removeHexPrefix(address.toLowerCase()) == utils.removeHexPrefix(signer2.toLowerCase());
  };

  /**
   * Deposit
   * @param {string} address 
   * @param {string} token 
   * @param {number} amount 
   * @param {string} key 
   */
  async deposit(address, token, amount, key) {
    amount = Web3.utils.toWei("" + amount, "ether");
    let value = 0;
    if (token == "0x0") {
      value = amount;
    }
    let result = await this.web3.eth.accounts.signTransaction({
      from: address,
      value: value,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.deposit(token, utils.toBN(amount)).encodeABI(),
    }, key);
    result = await this.web3.eth.sendSignedTransaction(result.rawTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  };

  /**
   * Create a deposit
   * @param {string} address 
   * @param {string} token 
   * @param {null} amount 
   */
  async createDeposit(address, token, amount) {
    amount = Web3.utils.toWei("" + amount, "ether");
    let value = 0;
    if (token == "0x0") {
      value = amount;
    }
    return {
      from: address,
      value: value,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.deposit(token, utils.toBN(amount)).encodeABI(),
    };
  }

  /**
   * Submit signed transaction to ethereum chain
   * @param {string} signedTransaction hex string of the signed transaction
   */
  async submitSignedTransaction(signedTransaction) {
    let result = await this.web3.eth.sendSignedTransaction(signedTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  }

  /**
   * Start deposit withdrawal
   * @param {number} depositPos 
   * @param {string} token 
   * @param {number} amount 
   * @param {string} from 
   * @param {string} key 
   */
  async startDepositWithdrawal(depositPos, token, amount, from, key) {
    let result = await this.web3.eth.accounts.signTransaction(createStartDepositWithdrawal(depositPos, token, amount, from), key);
    result = await this.web3.eth.sendSignedTransaction(result.rawTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  };

  /**
   * Create start deposit withdrawal
   * @param {number} depositPos 
   * @param {string} token 
   * @param {number} amount 
   * @param {string} from 
   */
  async createStartDepositWithdrawal(depositPos, token, amount, from) {
    return {
      from: from,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.startDepositExit(depositPos, token, utils.toBN(amount)).encodeABI(),
    };
  };

  /**
   * Start Withdrawal
   * @param {number} blkNum 
   * @param {number} txIndex 
   * @param {number} oIndex 
   * @param {string} txData 
   * @param {string} proof 
   * @param {string} confirmSigs 
   * @param {string} from 
   * @param {string} key 
   */
  async startWithdrawal(blkNum, txIndex, oIndex, txData, proof, confirmSigs, from, key) {
    let result = await this.web3.eth.accounts.signTransaction(createStartWithdrawal(blkNum, txIndex, oIndex, txData, proof, confirmSigs, from), key);
    result = await this.web3.eth.sendSignedTransaction(result.rawTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  };

  /**
   * Create start withdrawal
   * @param {number} blkNum 
   * @param {number} txIndex 
   * @param {number} oIndex 
   * @param {string} txData 
   * @param {string} proof 
   * @param {string} confirmSigs 
   * @param {string} from 
   */
  async createStartWithdrawal(blkNum, txIndex, oIndex, txData, proof, confirmSigs, from) {
    let {
      txBytes,
      sig1,
      sig2
    } = Block.splitTxData(txData);
    let sigs = utils.concatHex(sig1, sig2, confirmSigs);
    let utxoPos = blkNum * 1000000000 + txIndex * 10000 + oIndex;

    console.log("data", utxoPos, txBytes, proof, sigs);
    console.log("fromTxData", Transaction.fromTxData(txData).toJSON());
    console.log("merkleHash", Transaction.fromTxData(txData).merkleHash());

    return {
      from: from,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.startExit(utxoPos, txBytes, proof, sigs).encodeABI(),
    };
  };

  /**
   * Challenge withdrawal
   * @param {number} eUtxoPos 
   * @param {number} blkNum 
   * @param {number} txIndex 
   * @param {number} oIndex 
   * @param {string} txData 
   * @param {string} proof 
   * @param {string} confirmSig 
   * @param {string} from 
   * @param {string} key 
   */
  async challengeWithdrawal(eUtxoPos, blkNum, txIndex, oIndex, txData, proof, confirmSig, from, key) {
    let result = await this.web3.eth.accounts.signTransaction(createChallengeWithdrawal(eUtxoPos, blkNum, txIndex, oIndex, txData, proof, confirmSig, from), key);
    result = await this.web3.eth.sendSignedTransaction(result.rawTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  };

  /**
   * Create challenge withdrawal
   * @param {number} eUtxoPos 
   * @param {number} blkNum 
   * @param {number} txIndex 
   * @param {number} oIndex 
   * @param {string} txData 
   * @param {string} proof 
   * @param {string} confirmSig 
   * @param {string} from 
   */
  async createChallengeWithdrawal(eUtxoPos, blkNum, txIndex, oIndex, txData, proof, confirmSig, from) {
    let {
      txBytes,
      sig1,
      sig2
    } = Block.splitTxData(txData);
    let sigs = utils.concatHex(sig1, sig2);
    let utxoPos = blkNum * 1000000000 + txIndex * 10000 + oIndex;

    return {
      from: from,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.challengeExit(utxoPos, eUtxoPos, txBytes, proof, sigs, confirmSig).encodeABI(),
    };
  };

  /**
   * Finalize withdrawal
   * @param {string} from 
   * @param {string} key 
   */
  async finalizeWithdrawal(from, key) {
    let result = await this.web3.eth.accounts.signTransaction(createFinalizeWithdrawal(from), key);
    result = await this.web3.eth.sendSignedTransaction(result.rawTransaction)
    // console.log(JSON.stringify(result, null, 4));
    return result;
  };

  /**
   * Create finalize withdrawal
   * @param {string} from 
   */
  async createFinalizeWithdrawal(from) {
    return {
      from: from,
      gas: this.gasLimit,
      to: this.config.plasmaContractAddress,
      data: this.plasmaContract.methods.finalizeExits().encodeABI(),
    };
  };

  /**
   * Get deposits
   * @param {number} blockNumber 
   */
  async getDeposits(blockNumber) {
    let depositEvents = await this.plasmaContract.getPastEvents('Deposit', {
      filter: {
        blockNumber: blockNumber.toString()
      },
      fromBlock: 0,
      toBlock: 'latest'
    });

    let deposits = [];
    depositEvents.forEach(ev => deposits.push(ev.returnValues));
    deposits = deposits.filter((deposit) => !this.alreadyDeposit[deposit.depositBlock])
    deposits.sort((d1, d2) => (+d1.depositBlock - +d2.depositBlock));
    deposits.forEach((deposit) => {
      this.alreadyDeposit[deposit.depositBlock] = deposit;
    })
    return deposits;
  }

  /**
   * Get withdrawals from ExitStarted events.
   * @param {number} blockNumber 
   */
  async getWithdrawals(blockNumber) {
    // let withdrawalEvents = []
    // ExitFinalized
    let withdrawalEvents = await this.plasmaContract.getPastEvents('ExitStarted', {
      filter: {
        blockNumber: blockNumber.toString()
      },
      fromBlock: 0,
      toBlock: 'latest'
    });

    return withdrawalEvents.map(ev => ev.returnValues);
  };

  /**
   * Create a confirmation signature
   * @param {string} txHash 
   * @param {string} root 
   * @param {string} key 
   */
  confirmSig(txHash, root, key) {
    console.log("confirmSigHash", txHash, root, this.web3.utils.soliditySha3(txHash, root));

    // console.log(web3.eth.accounts.sign, utils.concatHex(txHash, root), key);
    let confirmSignature = this.web3.eth.accounts.sign(Web3.utils.soliditySha3(txHash, root), key).signature;
    console.log("confirmSignature", confirmSignature);
    return confirmSignature;
  }

  /**
   * Check if a confirmation signature is valid
   * @param {string} txHash 
   * @param {string} root 
   * @param {string} sig1 
   * @param {string} confSig1 
   * @param {string} sig2
   * @param {string} confSig2
   */
  isValidConfirmSig(txHash, root, sig1, confSig1, sig2, confSig2) {
    try {
      let check1 = true;
      let check2 = true;
      let confirmationHash = Web3.utils.soliditySha3(txHash, root);
      let account1 = this.web3.eth.accounts.recover(confirmationHash, confSig1);
      let account2 = this.web3.eth.accounts.recover(txHash, sig1);
      check1 = (utils.removeHexPrefix(account1.toLowerCase()) == utils.removeHexPrefix(account2.toLowerCase()));
      // var prefix = "\x19Ethereum Signed Message:\n32";
      // return Web3.utils.soliditySha3(prefix, message);
      console.log("check1", check1, root, confSig1, sig2, account1, account2);

      if (sig2 && sig2 != "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000") {
        let account1_2 = this.web3.eth.accounts.recover(confirmationHash, confSig2);
        let account2_2 = this.web3.eth.accounts.recover(txHash, sig2);
        check2 = (utils.removeHexPrefix(account1_2.toLowerCase()) == utils.removeHexPrefix(account2_2.toLowerCase()));
        console.log("check2", check2);

      }

      return check1 && check2;
      // let account1ec = utils.ecRecover(confirmationHash, confSig1);
      // let account2ec = utils.ecRecover(txHash, sig1);
      // return utils.removeHexPrefix(account1ec.toLowerCase()) == utils.removeHexPrefix(account2ec.toLowerCase());
    } catch (e) {
      console.log("error", e)
      return false
    }
  }

}

module.exports = RootChain;