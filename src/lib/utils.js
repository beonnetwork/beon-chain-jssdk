'use strict';

const Web3 = require("web3");
const util = require("ethereumjs-util");

/** 
 * @module utils 
 */

/**
 * Add hex prefix to msg
 * @param {string} msg a msg string 
 */
const addHexPrefix = (msg) => {
    if (Web3.utils.isHexStrict(msg)) {
        return msg;
    } else {
        return '0x' + msg;
    }
};

/**
 * Remove hex prefix from msg
 * @param {string} msg a msg string 
 */
const removeHexPrefix = (msg) => {
    if (Web3.utils.isHexStrict(msg)) {
        return msg.slice(2);
    } else {
        return msg;
    }
};

/**
 * Convert byte buffer to hex string
 * @param {Buffer} buf byte buffer
 * @param {boolean} withPrefix whether or not to add "0x" hex prefix
 */
const bufferToHex = (buf, withPrefix = true) => {
    if (withPrefix) {
        return addHexPrefix(buf.toString('hex'));
    } else {
        return buf.toString('hex');
    }
};

/**
 * Convert wei to ether
 * @param {number} amount the amount in wei
 */
const weiToEther = (amount) => {
    return amount / 1000000000000000000;
};

/**
 * Convert ether to wei
 * @param {number} amount the amount in ether
 */
const etherToWei = (amount) => {
    return amount * 1000000000000000000;
};

/**
 * Concatenate hex string
 * @param {...string} hexStrings zero or more hex strings to concatenate
 */
const concatHex = (...hexStrings) => {
    let combine = "0x";
    for (let i = 0; i < hexStrings.length; i++) {
        if (hexStrings[i]) {
            combine += removeHexPrefix(hexStrings[i]);
        }
    }
    return combine;
}

const numToStr = function (x) {
    x = +x;
    if (Math.abs(x) < 1.0) {
        var e = parseInt(x.toString().split('e-')[1]);
        if (e) {
            x *= Math.pow(10, e - 1);
            x = '0.' + (new Array(e)).join('0') + x.toString().substring(2);
        }
    } else {
        var e = parseInt(x.toString().split('+')[1]);
        if (e > 20) {
            e -= 20;
            x /= Math.pow(10, e);
            x += (new Array(e + 1)).join('0');
        }
    }
    return '' + x;
}

const toBN = function (x) {
    return Web3.utils.toBN(numToStr(x));
}

const hexToNumber = function (x) {
    return Web3.utils.hexToNumber(x);
}

const hexToNumberString = function (x) {
    return Web3.utils.hexToNumberString(x);
}

/**
 * Attempts to turn a value into a `Buffer`. As input it supports `Buffer`, `String`, `Number`, null/undefined, `BN` and other objects with a `toArray()` method.
 * @param {*} v the value
 */
const hexToBuffer = function (v) {
    if (!Buffer.isBuffer(v)) {
        if (Web3.utils.isHexStrict(v)) {
            v = Buffer.from(removeHexPrefix(v), 'hex')
        } else {
            v = Buffer.from(v)
        }
    }
    return v
}

const addEthereumPrefix = function (message) {
    var prefix = "\x19Ethereum Signed Message:\n32";
    return Web3.utils.soliditySha3(prefix, message);
}

const ecRecover = function (message, signature) {
    let sig = util.fromRpcSig(signature);
    let publicKey = util.ecrecover(hexToBuffer(message), sig.v, sig.r, sig.s);
    let signer = util.pubToAddress(publicKey).toString('hex');
    return addHexPrefix(signer);
}

const sleep = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
};

const splitConfirmSig = (confirmSig) => {
    confirmSig = confirmSig || "";
    let rawData = removeHexPrefix(confirmSig);
    let confirmSig1 = addHexPrefix(rawData.slice(0, 130));
    let confirmSig2 = addHexPrefix(rawData.slice(130, 260) || "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
    return {
        confirmSig1,
        confirmSig2,
    }
}

module.exports = {
    addHexPrefix,
    removeHexPrefix,
    bufferToHex,
    weiToEther,
    etherToWei,
    concatHex,
    numToStr,
    toBN,
    hexToNumber,
    hexToNumberString,
    hexToBuffer,
    addEthereumPrefix,
    ecRecover,
    sleep,
    splitConfirmSig,
};