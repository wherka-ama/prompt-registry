/**
 * Tests for FeedbackCommands
 * VS Code commands for collecting user feedback
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { FeedbackCommands, FeedbackableItem } from '../../src/commands/FeedbackCommands';
import { EngagementService } from '../../src/services/engagement/EngagementService';
import { Feedback } from '../../src/types/engagement';

suite('FeedbackCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let commands: FeedbackCommands;
    let mockEngagementService: sinon.SinonStubbedInstance<EngagementService>;
    let showInputBoxStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    const createMockItem = (overrides: Partial<FeedbackableItem> = {}): FeedbackableItem => ({
        resourceId: 'test-bundle',
        resourceType: 'bundle',
        name: 'Test Bundle',
        version: '1.0.0',
        ...overrides,
    });

    const createMockFeedback = (comment: string, rating?: 1 | 2 | 3 | 4 | 5): Feedback => ({
        id: 'feedback-123',
        resourceType: 'bundle',
        resourceId: 'test-bundle',
        comment,
        rating,
        timestamp: new Date().toISOString(),
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock VS Code window methods
        showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
        showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

        // Mock EngagementService
        mockEngagementService = {
            submitFeedback: sandbox.stub(),
        } as unknown as sinon.SinonStubbedInstance<EngagementService>;

        commands = new FeedbackCommands(mockEngagementService as unknown as EngagementService);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('submitFeedback()', () => {
        test('should submit feedback successfully', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Great bundle!');

            showInputBoxStub.resolves('Great bundle!');
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, true);
            assert.ok(result.feedback);
            assert.ok(showInformationMessageStub.calledOnce);
        });

        test('should return cancelled when user cancels input', async () => {
            const item = createMockItem();
            showInputBoxStub.resolves(undefined);

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('should show warning for empty feedback', async () => {
            const item = createMockItem();
            showInputBoxStub.resolves('   ');

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Empty feedback');
            assert.ok(showWarningMessageStub.calledOnce);
        });

        test('should work without engagement service', async () => {
            const commandsWithoutService = new FeedbackCommands();
            const item = createMockItem();
            showInputBoxStub.resolves('Test feedback');

            const result = await commandsWithoutService.submitFeedback(item);

            assert.strictEqual(result.success, true);
            assert.ok(result.feedback);
            assert.strictEqual(result.feedback.comment, 'Test feedback');
        });
    });

    suite('submitFeedbackWithRating()', () => {
        test('should submit feedback with rating', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Great!', 5);

            showQuickPickStub.resolves({ 
                label: '⭐⭐⭐⭐⭐', 
                description: '5 - Excellent' 
            });
            showInputBoxStub.resolves('Great!');
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.submitFeedbackWithRating(item);

            assert.strictEqual(result.success, true);
            assert.ok(mockEngagementService.submitFeedback.calledOnce);
            const callArgs = mockEngagementService.submitFeedback.firstCall.args;
            assert.strictEqual(callArgs[3]?.rating, 5);
        });

        test('should return cancelled when rating selection is cancelled', async () => {
            const item = createMockItem();
            showQuickPickStub.resolves(undefined);

            const result = await commands.submitFeedbackWithRating(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('should return cancelled when comment input is cancelled', async () => {
            const item = createMockItem();
            showQuickPickStub.resolves({ 
                label: '⭐⭐⭐⭐', 
                description: '4 - Good' 
            });
            showInputBoxStub.resolves(undefined);

            const result = await commands.submitFeedbackWithRating(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('should use default comment when empty', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Rated 4 stars', 4);

            showQuickPickStub.resolves({ 
                label: '⭐⭐⭐⭐', 
                description: '4 - Good' 
            });
            showInputBoxStub.resolves('');
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.submitFeedbackWithRating(item);

            assert.strictEqual(result.success, true);
            const callArgs = mockEngagementService.submitFeedback.firstCall.args;
            assert.strictEqual(callArgs[2], 'Rated 4 stars');
        });
    });

    suite('quickFeedback()', () => {
        test('should submit positive feedback', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Works great!', 5);

            showQuickPickStub.resolves({ 
                label: '👍 Works great!', 
                description: 'Positive feedback' 
            });
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.quickFeedback(item);

            assert.strictEqual(result.success, true);
            const callArgs = mockEngagementService.submitFeedback.firstCall.args;
            assert.strictEqual(callArgs[2], 'Works great!');
            assert.strictEqual(callArgs[3]?.rating, 5);
        });

        test('should redirect to full feedback for custom option', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Custom feedback');

            showQuickPickStub.onFirstCall().resolves({ 
                label: '✏️ Custom feedback', 
                description: 'Write your own feedback' 
            });
            showInputBoxStub.resolves('Custom feedback');
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.quickFeedback(item);

            assert.strictEqual(result.success, true);
            assert.ok(showInputBoxStub.calledOnce);
        });

        test('should ask for details for suggestion', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('[💡] Add more features');

            showQuickPickStub.resolves({ 
                label: '💡 Suggestion', 
                description: 'I have an idea for improvement' 
            });
            showInputBoxStub.resolves('Add more features');
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.quickFeedback(item);

            assert.strictEqual(result.success, true);
            const callArgs = mockEngagementService.submitFeedback.firstCall.args;
            assert.ok(callArgs[2].includes('💡'));
            assert.ok(callArgs[2].includes('Add more features'));
        });

        test('should return cancelled when selection is cancelled', async () => {
            const item = createMockItem();
            showQuickPickStub.resolves(undefined);

            const result = await commands.quickFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });
    });

    suite('Error Handling', () => {
        test('should handle service errors gracefully', async () => {
            const item = createMockItem();
            showInputBoxStub.resolves('Test feedback');
            mockEngagementService.submitFeedback.rejects(new Error('Service unavailable'));

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Service unavailable');
            assert.ok(showErrorMessageStub.calledOnce);
        });
    });

    suite('registerCommands()', () => {
        test('should register all feedback commands', () => {
            const mockContext = {
                subscriptions: [] as vscode.Disposable[],
            } as vscode.ExtensionContext;

            const registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand').returns({
                dispose: () => {},
            } as vscode.Disposable);

            commands.registerCommands(mockContext);

            assert.strictEqual(registerCommandStub.callCount, 3);
            assert.ok(registerCommandStub.calledWith('promptRegistry.submitFeedback'));
            assert.ok(registerCommandStub.calledWith('promptRegistry.submitFeedbackWithRating'));
            assert.ok(registerCommandStub.calledWith('promptRegistry.quickFeedback'));
        });
    });

    suite('setEngagementService()', () => {
        test('should allow setting engagement service after construction', async () => {
            const commandsWithoutService = new FeedbackCommands();
            const item = createMockItem();
            const feedback = createMockFeedback('Test');

            // First call without service
            showInputBoxStub.resolves('Test');
            const result1 = await commandsWithoutService.submitFeedback(item);
            assert.strictEqual(result1.success, true);

            // Set service and call again
            commandsWithoutService.setEngagementService(mockEngagementService as unknown as EngagementService);
            showInputBoxStub.resolves('Test 2');
            mockEngagementService.submitFeedback.resolves(feedback);
            
            const result2 = await commandsWithoutService.submitFeedback(item);
            assert.strictEqual(result2.success, true);
            assert.ok(mockEngagementService.submitFeedback.calledOnce);
        });
    });
});
