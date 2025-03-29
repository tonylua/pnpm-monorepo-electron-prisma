/**
 * @type {import('./AccountModel.d.ts').GetAccountModel}
 */
const getAccountModel = prisma => ({
  modelName: "Account",

  create: async function (username = null) {
    if (!username) return { account: null, error: "username cannot be null" };

    try {
      const account = await prisma.Account.create({
        data: {
          username,
        },
      });

      return { account, error: null };
    } catch (error) {
      console.error(error.message);
      return { account: null, error: error.message };
    }
  },

  update: async function (id = null, data = {}) {
    if (!id) throw new Error("No account id provided for update");
    try {
      const account = await prisma.Account.update({
        where: { id },
        data,
      });
      return { account, error: null };
    } catch (error) {
      console.error(error.message);
      return { account: null, error: error.message };
    }
  },

  updateArrayProp: async function (id, propName, arr) {
    const existArr = (await this.get({ id }))[propName] || [];
    const uniqueArrById = [...new Map([...existArr, ...arr].map((item) => [item.id, item])).values()];
    return this.update(id, {
      [propName]: {
        updateMany: uniqueArrById.reduce((acc, item) => {
          acc.where = {id: item.id};
          acc.data = item;
          return acc;
        }, {where: {}, data: {}})
      },
    });
  },

  get: async function (clause = {}) {
    try {
      const account = await prisma.Account.findFirst({
        where: {
          ...clause
        },
        include: {
        },
      });
      return account || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.Account.delete({
        where: clause,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      const results = await prisma.Account.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
});

module.exports = { getAccountModel };