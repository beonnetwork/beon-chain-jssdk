A BeOn side chain of Ethereum network. The gateway is currently supporting the following functionalities:

- ERC20 Token creation
- ETH/ERC20 Token deposit
- ETH/ERC20 Token transfer
- ETH/ERC20 Token withdraw
- Transaction confirmation
- Balance checking

This document details functions that available within the gateway which can be called using jsonrpc.

BeOn chain also provides the JSSDK to interact with the gateway. Examples are provided below. Please note that this is an ongoing development of the side chain. We appreciate any issues reported.

### Deployments

#### Rinkeby

Node Gateway: [https://rinkeby.beon.network/](https://rinkeby.beon.network/)  
Root Contract Address: [0x62f23c4659bc327833c2c7bb4abe2cf2fdca9fe2](https://rinkeby.etherscan.io/address/0x62f23c4659bc327833c2c7bb4abe2cf2fdca9fe2)
Block Explorer and DApp interface: [https://dapp.beon.network/](https://dapp.beon.network/)

### Usages

#### Install beon jssdk

    npm install @beon/jssdk

#### Setup SDK
```javascript
const BeOnSDK = require("@beon/jssdk");
let sdk = new BeOnSDK({
  host: "https://rinkeby.beon.network/",
  networkId: "4",
  provider: `https://rinkeby.infura.io/${process.env.INFURA_APIKEY}`,
  gas: 7000000
});
```
#### GETTING INFURA APIKEY

- Getting the infura apikey from here: [https://infura.io/](https://infura.io/)

#### Get Balances
```javascript
let address = "0x...";
sdk.getBalances(address).then(console.log).catch(console.error);
```
#### Create Token
```javascript
let account = "0x...";
let key = "0x...";
let initialAmount = 0;
let tokenName = "BeOn";
let decimalUnits = 18;
let tokenSymbol = "BEO";

sdk.createToken({
  account,
  key
}, {
  initialAmount,
  tokenName,
  decimalUnits,
  tokenSymbol
}).then((response)=>{
  let tokenAddress = response.result.result.logs[0].address;  
}).catch(console.error);
```
#### Mint Token
```javascript
sdk.mintToken({
  account,
  key
}, {
  tokenAddress: "0x...",
  to: "0x...",
  amount: "10000000000000000",
}).then(console.log).catch(console.error);
```
#### Deposit
```javascript
sdk.deposit({
  account,
  key
}, {
  token: "0x0", // token address. 0x0 is ETH.
  amount: "1" // in ether
}).then(console.log).catch(console.error);
```
#### Transact
```javascript
sdk.transfer({
  account,
  key
}, {
  token: "0x0", // token address. 0x0 is ETH.
  to: "0x...",
  amount: "0.01" // in ether
}).then(console.log).catch(console.error);
```
#### Confirm Transaction
```javascript
sdk.confirmTx({
  account,
  key
}, {
  blkNum: "100000",
  txIndex: "0"
}).then(console.log).catch(console.error);
```
#### Withdraw
```javascript
sdk.withdraw({
  account: "0x...",
  key: "0x..."
}, {
  blkNum: "200000",
  txIndex: "1",  
  oIndex: "0"
}).then(console.log).catch(console.error);
```
#### GENERATE ETHEREUM ACCOUNT
```javascript
let web3 = new Web3(new Web3.providers.HttpProvider(`https://rinkeby.infura.io/${process.env.INFURA_APIKEY}`));
let account = web3.eth.accounts.create();
```
#### INSTALL METAMASK AND CREATE RINKEBY ACCOUNT

- Download and install Metamask by following the instruction here: [https://medium.com/publicaio/how-to-create-a-metamask-account-e6d0ef156176](https://medium.com/publicaio/how-to-create-a-metamask-account-e6d0ef156176)
- Create account
- Export private key

#### FUND THE RINKEBY ACCOUNT

- Follow the instruction from here to fund your rinkeby wallet: [https://www.rinkeby.io/#faucet](https://www.rinkeby.io/#faucet)
