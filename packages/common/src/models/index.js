const { getAccountModel }          = require("./AccountModel");
const { getThreadModel }           = require("./ThreadModel");
const { getThreadMessageModel }    = require("./ThreadMessageModel");

/**
 * @type {import('../types').TypeDBModels}
 */
const modelGetters = {
    getAccountModel,
    getThreadModel,
    getThreadMessageModel
}

module.exports = modelGetters