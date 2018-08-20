'use strict';

const jayson = require("jayson/promise");
const Web3 = require("web3");

const BrandedTokenFactoryArtifacts = require("./contracts/BrandedTokenFactory.json");
const BrandedTokenArtifacts = require("./contracts/BrandedToken.json");
// const RootChainArtifacts = require("./contracts/RootChain.json");
const utils = require("./lib/utils");
const Block = require("./lib/Block");
const Transaction = require("./lib/Transaction");

class BeOnSDK {
  constructor({
    host,
    networkId,
    provider,
    gas,
    gasPrice,
    contractAddressOfBrandedTokenFactory
  }) {
    this.config = {
      host,
      networkId,
      provider,
      gas,
      gasPrice,
      contractAddressOfBrandedTokenFactory
    };
    if (this.config.host.indexOf("https") >= 0) {
      this.client = jayson.client.https(this.config.host);
    } else {
      this.client = jayson.client.http(this.config.host);
    }
    this.web3 = new Web3(new Web3.providers.HttpProvider(this.config.provider));

    this.BrandedTokenFactory = new this.web3.eth.Contract(
      BrandedTokenFactoryArtifacts.abi,
      this.config.contractAddressOfBrandedTokenFactory || BrandedTokenFactoryArtifacts.networks[this.config.networkId].address
    );
  }

  async _signedAndSubmit(json, key) {
    // signed
    let result = await this.web3.eth.accounts.signTransaction(json, key);
    let signedTransaction = result.rawTransaction;
    // submit
    let response = await this.client.request('submitSignedTransaction', {
      signedTransaction
    }).catch((err) => {
      throw err;
    });
    return response;
  }

  async getBalances(address) {
    if(!address){
      throw "address is not provided"
    }
    let address = address.toLowerCase();
    let response = await this.client.request("getUTXOsByAddress", {
      address,
    }).catch(err => {
      throw err;
    });
    let json = response.result.result;
    return json;
  }

  async getNonce(account) {
    return this.web3.eth.getTransactionCount(account);
  }

  async createToken({
    account,
    key
  }, {
    initialAmount,
    tokenName,
    decimalUnits,
    tokenSymbol
  }) {
    if (!this.BrandedTokenFactory) {
      return;
    }
    initialAmount = this.web3.utils.toBN(initialAmount);
    // let nonce = await this.web3.eth.getTransactionCount(account);
    let result = await this._signedAndSubmit({
      from: account,
      // nonce: nonce,
      gas: this.config.gas,
      gasPrice: this.config.gasPrice,
      to: this.BrandedTokenFactory.options.address,
      data: this.BrandedTokenFactory.methods.create(initialAmount, tokenName, decimalUnits, tokenSymbol).encodeABI(),
    }, key);

    return result;
  }

  async mintToken({
    account,
    key
  }, {
    tokenAddress,
    to,
    amount,
  }) {
    let BrandedToken = new this.web3.eth.Contract(
      BrandedTokenArtifacts.abi, tokenAddress
    );

    amount = Web3.utils.toBN(Web3.utils.toWei("" + amount, "ether"));
    // let nonce = await this.web3.eth.getTransactionCount(account);
    let result = await this._signedAndSubmit({
      from: account,
      // nonce: nonce,
      gas: this.config.gas,
      gasPrice: this.config.gasPrice,
      to: BrandedToken.options.address,
      data: BrandedToken.methods.mint(to, amount).encodeABI(),
    }, key);

    return result;
  }

  async deposit({
    account,
    key
  }, {
    token,
    amount
  }) {
    if (
      token !== "0x0" &&
      token !== "0x0000000000000000000000000000000000000000" &&
      token.length === 42
    ) {
      // Token address
      let BrandedToken = new this.web3.eth.Contract(
        BrandedTokenArtifacts.abi,
        token, {
          gas: this.config.gas,
        },
      );
      let from = account;
      let result = await BrandedToken.methods
        .approve(this.RootChain.options.address, Web3.utils.toWei("" + amount, "ether"))
        .send({
          from
        });
    }
    let address = account;
    let response = await this.client.request("deposit", {
      address,
      token,
      amount,
    }).catch(err => {
      throw err;
    });
    let json = response.result.result;
    return this._signedAndSubmit(json, key);
  }

  async transfer({
    account,
    key
  }, {
    token,
    to,
    amount
  }) {
    let confirmSig = null;
    let from = account;
    let response = await this.client.request("transact", {
      token,
      from,
      to,
      amount,
      confirmSig,
    }).catch(err => {
      throw err;
    });

    let json = response.result.result;
    let tx = Transaction.fromJSON(json);

    // let prefix = "\x19Ethereum Signed Message:\n32";
    // let txHashed = this.web3.utils.soliditySha3(prefix, tx.hash());
    let txHashed = tx.hash();
    let signature = await this.web3.eth.accounts.sign(txHashed, key).signature;
    tx.setSignature(signature);

    let signedTransaction = tx.toJSON();
    response = await this.client.request("submitTransact", {
      signedTransaction,
    }).catch(err => {
      throw err;
    });

    // wait for the tx to be mined
    let found = -1;
    let blkNum;
    let root;
    let nTries = 0;
    while (found < 0 && nTries < 3) {
      await utils.sleep(1000);
      // get latest block
      response = await this.client.request("getLatestBlock", {}).catch(err => {
        throw err;
      });
      if (!response || !response.result || !response.result.result) {
        throw "Blocks do not exist";
      }
      let block = Block.fromJSON(response.result.result);
      blkNum = block.blockHeader.blockNumber;
      root = utils.addHexPrefix(block.blockHeader.merkleRoot);
      let txData = tx.data();
      found = block.transactions.findIndex(_tx => {
        return _tx === txData;
      });
      nTries += 1;
    }
    if (found < 0) {
      throw "Transaction not found or has yet been mined";
    }
    let txIndex = found;

    // wait for the tx to be mined and then submit confirm signature
    // let confirmationHashed = this.web3.utils.soliditySha3(
    //   prefix,
    //   this.web3.utils.soliditySha3(tx.hash(), root),
    // );
    let confirmationHashed = this.web3.utils.soliditySha3(tx.hash(), root);
    let confirmSignature = await this.web3.eth.accounts.sign(confirmationHashed, key).signature;

    // submit confirm
    response = await this.client.request("confirmTx", {
      blkNum,
      txIndex,
      confirmSignature,
    }).catch(err => {
      throw err;
    });

    return response;
  }

  async _getTxHashRoot(blkNum, txIndex) {
    let response = await this.client.request("getBlocks", {
      blkNum
    }).catch(err => {
      throw err;
    });
    if (!response.result || !response.result.result || response.result.result.length == 0) {
      throw "block does not exist";
    }
    let block = Block.fromJSON(response.result.result[0]);
    if (!block.transactions || block.transactions.length == 0 || block.transactions.length <= txIndex) {
      throw "transactions do not exist";
    }
    let data = block.transactions[txIndex];
    let {
      txBytes,
      sig1,
      sig2
    } = Block.splitTxData(data);
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
   * Create a confirmation signature
   * @param {string} txHash 
   * @param {string} root 
   * @param {string} key 
   */
  _confirmSig(txHash, root, key) {
    let confirmSignature = this.web3.eth.accounts.sign(Web3.utils.soliditySha3(txHash, root), key).signature;
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
  _isValidConfirmSig(txHash, root, sig1, confSig1, sig2, confSig2) {
    try {
      let check1 = true;
      let check2 = true;
      let confirmationHash = Web3.utils.soliditySha3(txHash, root);
      let account1 = this.web3.eth.accounts.recover(confirmationHash, confSig1);
      let account2 = this.web3.eth.accounts.recover(txHash, sig1);
      check1 = (utils.removeHexPrefix(account1.toLowerCase()) == utils.removeHexPrefix(account2.toLowerCase()));
      // var prefix = "\x19Ethereum Signed Message:\n32";
      // return Web3.utils.soliditySha3(prefix, message);
      if (sig2 && sig2 != "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000") {
        let account1_2 = this.web3.eth.accounts.recover(confirmationHash, confSig2);
        let account2_2 = this.web3.eth.accounts.recover(txHash, sig2);
        check2 = (utils.removeHexPrefix(account1_2.toLowerCase()) == utils.removeHexPrefix(account2_2.toLowerCase()));
      }
      return check1 && check2;
      // let account1ec = utils.ecRecover(confirmationHash, confSig1);
      // let account2ec = utils.ecRecover(txHash, sig1);
      // return utils.removeHexPrefix(account1ec.toLowerCase()) == utils.removeHexPrefix(account2ec.toLowerCase());
    } catch (e) {
      return false
    }
  }

  async _generateConfirmSig(blkNum, txIndex, key) {
    let data = await this._getTxHashRoot(blkNum, txIndex);
    let txHash = data.txHash;
    let root = data.root;
    let sig1 = data.sig1;
    let sig2 = data.sig2;
    let confirmSig1 = this._confirmSig(txHash, root, key);
    let confirmSig2 = this._confirmSig(txHash, root, key);
    let isValid = this._isValidConfirmSig(txHash, root, sig1, confirmSig1, sig2, confirmSig2);
    if (isValid) {
      return utils.concatHex(confirmSig1, confirmSig2);
    } else {
      return "";
    }
  }

  async confirmTx({
    account,
    key
  }, {
    blkNum,
    txIndex
  }) {
    let confirmSignature = await this._generateConfirmSig(blkNum, txIndex, key);
    if (!confirmSignature) {
      return {
        "status": "error",
        "error": "Confirmation signature is not valid"
      };
    }
    let response = await this.client.request("confirmTx", {
      blkNum,
      txIndex,
      confirmSignature
    }).catch(err => {
      throw err;
    });
    return response;
  }

  async withdraw({
    account,
    key
  }, {
    blkNum,
    txIndex,
    oIndex
  }) {
    let from = account;
    let response = await this.client.request("startExit", {
      blkNum,
      txIndex,
      oIndex,
      from
    }).catch(err => {
      throw err;
    });

    let data = response.result.result;
    return this._signedAndSubmit(data.result, key);
  }

  // TODO
  async exchange() {

  }
  // TODO
  async createCoupon() {

  }

}

module.exports = BeOnSDK;