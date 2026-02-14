import { MongoClient, Db } from 'mongodb'

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
}

function getClient(): MongoClient {
  if (!global._mongoClient) {
    const uri = process.env.MONGO_CONNECTION_STRING
    if (!uri) throw new Error('MONGO_CONNECTION_STRING is not set')
    global._mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    })
  }
  return global._mongoClient
}

export function getDb(): Db {
  return getClient().db('kardashev')
}
