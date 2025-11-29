export function installMockGeminiCountTokens(totalTokens: number): void {
  jest.doMock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: () => ({
        countTokens: jest.fn().mockResolvedValue({ totalTokens }),
      }),
    })),
  }));
}
