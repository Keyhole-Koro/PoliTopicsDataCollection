import http from 'node:http';

import type { RawMeetingData } from '@NationalDietAPI/Raw';

export type MockNationalDietApi = {
  url: string;
  close: () => Promise<void>;
};

export async function startMockNationalDietApi(response: RawMeetingData): Promise<MockNationalDietApi> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });

    server.on('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Failed to acquire server address'));
      }
      const url = `http://${address.address}:${address.port}`;
      resolve({
        url,
        close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

export function installMockGeminiCountTokens(totalTokens: number): void {
  jest.doMock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: () => ({
        countTokens: jest.fn().mockResolvedValue({ totalTokens }),
      }),
    })),
  }));
}
