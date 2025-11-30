module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', '<rootDir>/src'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  moduleNameMapper: {
    '^@DynamoDB/(.*)$': '<rootDir>/src/DynamoDB/$1',
    '^@LLMSummarize/(.*)$': '<rootDir>/src/LLMSummarize/$1',
    '^@NationalDietAPI/(.*)$': '<rootDir>/src/NationalDietAPI/$1',
    '^@llm/(.*)$': '<rootDir>/src/llm/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@interfaces/(.*)$': '<rootDir>/src/interfaces/$1',
    '^@prompts/(.*)$': '<rootDir>/src/prompts/$1',
    '^@S3/(.*)$': '<rootDir>/src/S3/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
};
