const { ensureTable } = require('./src/db/dynamodb');
ensureTable()
  .then(() => console.log('DynamoDB table checked'))
  .catch((err) => console.error('DynamoDB table check failed:', err));
