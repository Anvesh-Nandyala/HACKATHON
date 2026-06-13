const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-2',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'CircularCommercePlatform';

/**
 * Create the DynamoDB table if it doesn't exist.
 */
async function ensureTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`[DynamoDB] Table "${TABLE_NAME}" exists.`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`[DynamoDB] Creating table "${TABLE_NAME}"...`);
      await client.send(new CreateTableCommand({
        TableName: TABLE_NAME,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          },
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      }));
      console.log(`[DynamoDB] Table "${TABLE_NAME}" created successfully.`);
    } else {
      throw err;
    }
  }
}

// ─── Generic operations ───

async function putItem(item) {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

async function getItem(pk, sk) {
  const { Item } = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
  }));
  return Item || null;
}

async function queryByPK(pk, skPrefix) {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: skPrefix
      ? 'PK = :pk AND begins_with(SK, :sk)'
      : 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pk },
  };
  if (skPrefix) params.ExpressionAttributeValues[':sk'] = skPrefix;

  const { Items } = await docClient.send(new QueryCommand(params));
  return Items || [];
}

async function queryGSI(indexName, pkName, pkValue, skPrefix) {
  const params = {
    TableName: TABLE_NAME,
    IndexName: indexName,
    KeyConditionExpression: skPrefix
      ? `${pkName} = :pk AND begins_with(${pkName.replace('PK', 'SK')}, :sk)`
      : `${pkName} = :pk`,
    ExpressionAttributeValues: { ':pk': pkValue },
  };
  if (skPrefix) params.ExpressionAttributeValues[':sk'] = skPrefix;

  const { Items } = await docClient.send(new QueryCommand(params));
  return Items || [];
}

async function updateItem(pk, sk, updates) {
  const expressions = [];
  const names = {};
  const values = {};

  Object.entries(updates).forEach(([key, value], i) => {
    expressions.push(`#f${i} = :v${i}`);
    names[`#f${i}`] = key;
    values[`:v${i}`] = value;
  });

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function conditionalPut(item, conditionExpression, expressionValues) {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: conditionExpression,
    ExpressionAttributeValues: expressionValues,
  }));
}

module.exports = {
  docClient,
  client,
  TABLE_NAME,
  ensureTable,
  putItem,
  getItem,
  queryByPK,
  queryGSI,
  updateItem,
  conditionalPut,
};
