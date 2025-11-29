const UNCONDITIONAL_DISCOUNT_PROFILES = Object.freeze([
  {
    alias: 'JM',
    displayName: 'JM Alimentos',
    nameTokens: ['JM', 'ALIMENTOS'],
    customerRates: {
      '75315333007200': '0.03',
      '75315333018660': '0.03',
      '75315333020134': '0.03',
      '75315333021378': '0.06',
      '75315333014169': '0.03',
      '75315333030873': '0.06',
      '75315333011810': '0.03',
    },
    customerLabels: {},
  },
  {
    alias: 'OLG',
    displayName: 'OLG Indústria e Comércio',
    nameTokens: ['OLG', 'INDUSTRIA', 'COMERCIO'],
    customerRates: {
      '75315333007200': '0.02',
      '75315333018660': '0.02',
      '75315333020134': '0.02',
      '75315333021378': '0.04',
      '75315333014169': '0.02',
      '75315333030873': '0.04',
      '75315333011810': '0.02',
      '06057223030089': '0.01',
      '06057223036362': '0.01',
      '06057223040556': '0.01',
      '06057223043571': '0.01',
      '06057223044209': '0.01',
    },
    customerLabels: {},
  },
]);

module.exports = {
  UNCONDITIONAL_DISCOUNT_PROFILES,
};
