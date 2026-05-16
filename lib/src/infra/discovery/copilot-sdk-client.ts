/**
 * Copilot SDK client implementation.
 *
 * Mock implementation for testing and development.
 * Real implementation will integrate with actual Copilot SDK.
 * @module infra/discovery/copilot-sdk-client
 */

import type {
  CopilotSdk,
  CopilotSession,
  SessionOptions,
} from '../../ports/copilot-sdk';

/**
 * Mock Copilot session implementation.
 */
class MockCopilotSession implements CopilotSession {
  public async sendAndWait(_prompt: string): Promise<string> {
    // Mock implementation - returns empty string
    return '';
  }

  public async sendWithStream(
    _prompt: string,
    _onChunk: (chunk: string) => void
  ): Promise<string> {
    // Mock implementation - returns empty string
    return '';
  }

  public async close(): Promise<void> {
    // Mock implementation - no-op
  }
}

/**
 * Copilot SDK client implementation.
 *
 * This is a mock implementation for development and testing.
 * The real implementation will integrate with the actual Copilot SDK.
 */
export class CopilotSdkClient implements CopilotSdk {
  public isAvailable(): boolean {
    // Mock implementation - SDK not available
    return false;
  }

  public async createSession(_options: SessionOptions): Promise<CopilotSession> {
    // Mock implementation - returns mock session
    return new MockCopilotSession();
  }
}
