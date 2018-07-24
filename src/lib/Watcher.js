'use strict'

const RootChain = require("./RootChain");

/**
 * Watch for invalid ExitStarted events and submit challenges
 * Watch for finalizable exits and automatically finalize exits, limit the rate
 */
class Watcher {
  constructor(config) {
    this.rootChain = new RootChain(config);
  }
  /**
   * Start watching
   * @param {number} checkInterval interval to check for pending transactions and generate a block
   */
  startWatching(checkInterval = 1000) {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
    }
    this.watchTimer = setInterval(async () => {
      try {
        let withdrawalEvents = await this.plasmaContract.getPastEvents('ExitStarted', {
          filter: {
            blockNumber: blockNumber.toString()
          },
          fromBlock: 0,
          toBlock: 'latest'
        });
        let events = withdrawalEvents.map(ev => ev.returnValues);

        // TODO

      } catch (e) {
        console.log(e);
        throw e;
      }
    }, checkInterval);
    return this;
  }
}

module.exports = Watcher;