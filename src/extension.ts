import * as vscode from 'vscode';
import fetch from 'node-fetch';
import path from 'path';
import { processLocalKeys } from './localKeys';

export const OPENAI_O_SERIES = ["o1", "o1-2024-12-17", "o1-mini", "o1-mini-2024-09-12",
    "o1-preview-2024-09-12"];
export const OPENAI_MODEL_NAMES = [
    "gpt-4o", "gpt-4o-2024-11-20", "gpt-4o-2024-08-06", "gpt-4o-2024-05-13", "chatgpt-4o-latest",
    "gpt-4o-mini-2024-07-18", "gpt-4o-mini", "gpt-4-turbo", "gpt-4-turbo-2024-04-09", "gpt-4-turbo-preview",
    "gpt-4-0125-preview", "gpt-4-1106-preview", "gpt-4", "gpt-4-0613", "gpt-4-0314",
    "gpt-3.5-turbo-0125", "gpt-3.5-turbo", "gpt-3.5-turbo-1106", "gpt-3.5-turbo-instruct"
];

export const ANTHROPIC_MODEL_NAMES = [
    "claude-3-5-sonnet-20241022", "claude-3-5-sonnet-latest", "claude-3-5-haiku-20241022",
    "claude-3-5-haiku-latest", "claude-3-opus-20240229", "claude-3-opus-latest",
    "claude-3-sonnet-20240229", "claude-3-haiku-20240307"
];
export const OPENROUTER_MODEL_NAMES = ["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-r1", "qwen/qwen-2.5-coder-32b-instruct"];

export const OPENROUTER_VISION_SUPPORT = ["x-ai/grok-2-vision-1212", "meta-llama/llama-3.2-90b-vision-instruct"];
export const OPENROUTER_LONG_LIST = [
    "deepseek/deepseek-r1-distill-llama-70b", "google/gemini-2.0-flash-thinking-exp:free", "sophosympatheia/rogue-rose-103b-v0.2:free",
    "minimax/minimax-01", "mistralai/codestral-2501", "mistralai/codestral-mamba",
    "mistralai/mistral-large-2411", "mistralai/ministral-8b", "mistralai/ministral-3b",
    "mistralai/mistral-nemo", "microsoft/phi-4", "deepseek/deepseek-chat",
    "qwen/qvq-72b-preview", "qwen/qwq-32b-preview", "qwen/qwen-2.5-7b-instruct",
    "x-ai/grok-2-1212", "cohere/command-r7b-12-2024", "amazon/nova-lite-v1",
    "amazon/nova-micro-v1", "amazon/nova-pro-v1", "inflection/inflection-3-pi",
    "nousresearch/hermes-3-llama-3.1-70b", "nousresearch/hermes-3-llama-3.1-70b", "google/gemma-2-9b-it",
    "mistralai/mixtral-8x22b-instruct", "cognitivecomputations/dolphin-mixtral-8x22b"
];
const SECRET_KEYS = {
    OPENAI: 'openai_api_key',
    ANTHROPIC: 'anthropic_api_key',
    OPENROUTER: 'openrouter_api_key'
};

export async function activate(context: vscode.ExtensionContext) {
    let statusBarHint: vscode.StatusBarItem | undefined;
   
    // Add state management for history
    let messageHistory: string[] = context.globalState.get('messageHistory', []);
    let imageUrlHistory: string[] = context.globalState.get('imageUrlHistory', []);
    let lastSelectedModels: string[] = context.globalState.get('lastSelectedModels', []);
    let requestCount: number = context.globalState.get('requestCount', 0);
    let lastPaidCheck: number = context.globalState.get('lastPaidCheck', 0);
    let isPaidUser: boolean = context.globalState.get('isPaidUser', false);
    let apiKey: string = context.globalState.get('apiKey', '');

    let localKeys = {
        openai: await context.secrets.get(SECRET_KEYS.OPENAI),
        anthropic: await context.secrets.get(SECRET_KEYS.ANTHROPIC),
        openrouter: await context.secrets.get(SECRET_KEYS.OPENROUTER)
    };
    const setupLocalKeysCommand = vscode.commands.registerCommand('promptoctopus.useLocalKeys', async () => {
        const choice = await vscode.window.showQuickPick([
            { label: 'OpenAI', description: 'Set OpenAI API Key' },
            { label: 'Anthropic', description: 'Set Anthropic API Key' },
            { label: 'OpenRouter', description: 'Set OpenRouter API Key' },
            { label: 'Clear All', description: 'Remove all stored API keys' }
        ], {
            placeHolder: 'Select which API key to configure - all are stored locally and never touch Prompt Octopus Servers'
        });

        if (!choice) {return;}

        if (choice.label === 'Clear All') {
            await context.secrets.delete(SECRET_KEYS.OPENAI);
            await context.secrets.delete(SECRET_KEYS.ANTHROPIC);
            await context.secrets.delete(SECRET_KEYS.OPENROUTER);
            localKeys = { openai: undefined, anthropic: undefined, openrouter: undefined };
            vscode.window.showInformationMessage('All API keys have been cleared');
            return;
        }

        const key = await vscode.window.showInputBox({
            prompt: `Enter your ${choice.label} API key`,
            password: true,
            placeHolder: choice.label === 'OpenAI' ? 'sk-...' : 
                        choice.label === 'Anthropic' ? 'sk-ant-...' : 
                        'sk-or-...'
        });

        if (key) {
            try {
                switch (choice.label) {
                    case 'OpenAI':
                        await context.secrets.store(SECRET_KEYS.OPENAI, key);
                        localKeys.openai = key;
                        break;
                    case 'Anthropic':
                        await context.secrets.store(SECRET_KEYS.ANTHROPIC, key);
                        localKeys.anthropic = key;
                        break;
                    case 'OpenRouter':
                        await context.secrets.store(SECRET_KEYS.OPENROUTER, key);
                        localKeys.openrouter = key;
                        break;
                }
                vscode.window.showInformationMessage(`${choice.label} API key has been securely stored`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to store ${choice.label} API key: ${error}`);
            }
        }
    });

    context.subscriptions.push(setupLocalKeysCommand);


    const shouldUseLocalApi = (model: string): boolean => {
        if (OPENAI_MODEL_NAMES.includes(model) && localKeys.openai) {
            return true;
        }
        if (ANTHROPIC_MODEL_NAMES.includes(model) && localKeys.anthropic) {
            return true;
        }
        if (OPENROUTER_MODEL_NAMES.includes(model) && localKeys.openrouter) {
            return true;
        }
        return false;
    };

    // check if there is a uuid for the user, if not, create one
    let uuid: string = context.globalState.get('uuid', '');
    if (!uuid || uuid === '') {
        // add indication that we're performing initial setup
        const statusBar = getStatusBarItem();
        statusBar.text = "$(sync~spin) Setting up extension...";
        statusBar.show();
        
        const response = await fetch('https://server.promptoctopus.com/get_free_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Custom-Header': 'MyVSCodeExtension' },
        });
        const result = await response.json();
        uuid = result.temp_token;
        console.log("updating_uuid");
        await context.globalState.update('uuid', uuid);
        
        statusBar.hide();
    };
    console.log(uuid);
    console.log(apiKey);
    console.log(isPaidUser);

    // const uriHandler = vscode.window.registerUriHandler({
    //     async handleUri(uri: vscode.Uri) {
    //         // URI format will be: vscode://promptoctopus/auth?token=xxx
    //         if (uri.path === '/auth') {
    //             const params = new URLSearchParams(uri.query);
    //             const token = params.get('token');
    //             if (token) {
    //                 // Store the token
    //                 apiKey = token;
    //                 await context.globalState.update('apiKey', apiKey);
    //                 // Force a recheck of paid status
    //                 await checkPaidStatus(true);
    //                 vscode.window.showInformationMessage('Successfully authenticated!');
    //             }
    //         }
    //     }
    // });
    // context.subscriptions.push(uriHandler);
    const authCommand = vscode.commands.registerCommand('extension.startAuth', () => {
        // prompt to enter an email or auth token
        vscode.window.showInputBox({
            prompt: 'Enter the token you received in your email',
            placeHolder: '123-abc-def-456',
            ignoreFocusOut: true,
        }).then(async (input) => {
            if (input) {
                const response = await fetch('https://server.promptoctopus.com/authenticate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${input}`, 'X-Custom-Header': 'MyVSCodeExtension' },
                });
                const result = await response.json();
                // response will look like {"authenticated": True, "paying": True}
                if (result.authenticated) {
                    if (result.paying) {
                        await context.globalState.update('apiKey', input);
                        apiKey = input;
                        await context.globalState.update('isPaidUser', true);
                        isPaidUser = true;
                        vscode.window.showInformationMessage('Successfully authenticated! You now have access to 500 requests per month.');
                    } else {
                        vscode.window.showErrorMessage('You don\'t appear to be a paid user. Please upgrade at https://promptoctopus.com/signup to continue. If you believe this is an error, please contact benjamin.guzovsky@gmail.com');
                    }
                } else {
                    vscode.window.showErrorMessage('Invalid token - if you believe this is an error, please contact benjamin.guzovsky@gmail.com');
                }
            }
        });
    });
    context.subscriptions.push(authCommand);

    // const vsCodeCallback = `vscode://promptoctopus/auth?token=${userToken}`;
    // window.location.href = vsCodeCallback;

    const MAX_HISTORY_ITEMS = 30; // Limit history items

    const updateMessageHistory = async (message: string) => {
        messageHistory = [message, ...messageHistory.filter(m => m !== message)].slice(0, MAX_HISTORY_ITEMS);
        await context.globalState.update('messageHistory', messageHistory);
    };

    // Helper to update image URL history
    const updateImageUrlHistory = async (urls: string) => {
        if (!urls || urls.trim() === '') {
            return;
        }
        imageUrlHistory = [urls, ...imageUrlHistory.filter(u => u !== urls)].slice(0, MAX_HISTORY_ITEMS);
        await context.globalState.update('imageUrlHistory', imageUrlHistory);
    };

    // Helper to update model preferences
    const updateModelPreferences = async (models: string[]) => {
        lastSelectedModels = models;
        await context.globalState.update('lastSelectedModels', models);
    };

    // Create a status bar item
    function showHint() {
        if (!statusBarHint) {
            statusBarHint = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        }
        statusBarHint.text = 'Press ctrl/cmd+shift+j to eval selected text';
        statusBarHint.show();
    }

    function hideHint() {
        if (statusBarHint) {
            statusBarHint.hide();
        }
    }

    // Listen for selection changes
    vscode.window.onDidChangeTextEditorSelection((event) => {
        const editor = event.textEditor;
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (selectedText && selectedText.trim()) {
            showHint();
        } else {
            hideHint();
        }
    });

    let statusBarItem: vscode.StatusBarItem;

    // Create status bar item if it doesn't exist
    function getStatusBarItem() {
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        }
        return statusBarItem;
    }

    // Command to handle the API call
    const disposable = vscode.commands.registerCommand('extension.checkText', async () => {
        const MAX_FREE_REQUESTS = 10;
        const MAX_PAID_REQUESTS = 500;
        if (!isPaidUser && requestCount >= MAX_FREE_REQUESTS) {
            vscode.window.showInformationMessage(
                'You\'ve reached the free request limit. Please log in or upgrade to use premium features', 
                'Upgrade',
                'Log in'
            ).then(selection => {
                if (selection === 'Upgrade') {
                    vscode.env.openExternal(vscode.Uri.parse('https://promptoctopus.com/signup'));
                } else if (selection === 'Log in') {
                    vscode.commands.executeCommand('extension.startAuth');
                }
            });
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showErrorMessage('No text selected.');
            return;
        }

        // Create multi-input dialog
        // Create message input
        const messageInput = vscode.window.createQuickPick();
        messageInput.title = "Build user input (1/3)";
        messageInput.placeholder = "Enter user message here...";
        messageInput.items = messageHistory.map((msg: string) => ({
            label: msg,
            iconPath: new vscode.ThemeIcon('history')
        }));

        messageInput.onDidChangeSelection(async (selection) => {
            if (selection.length > 0) {
                userMessage = selection[0].label;
            }
        });

        let userMessage = '';
        let imageUrls = '';
        let historyIndex = -1;


        messageInput.onDidChangeValue(text => {
            userMessage = text;
        });

        messageInput.onDidAccept(async () => {
            messageInput.hide();
            await updateMessageHistory(userMessage);

            if (!userMessage) {
                return;
            }
            
            // Create image URLs input
            const imageInput = vscode.window.createQuickPick();
            imageInput.placeholder = "Enter image URLs (Optional, comma-separated)";
            imageInput.title = "Build user input (2/3)";
            imageInput.items = [{
                label: "Submit",
                // detail: "Press enter to submit",
                iconPath: new vscode.ThemeIcon('image')
            }];

            imageInput.onDidChangeValue(text => {
                imageUrls = text;
            });

            imageInput.onDidTriggerButton(async (button) => {
                if (button === vscode.QuickInputButtons.Back) {
                    if (historyIndex < imageUrlHistory.length - 1) {
                        historyIndex++;
                        imageInput.value = imageUrlHistory[historyIndex];
                    }
                } else if (button === vscode.QuickInputButtons.Back) {
                    if (historyIndex > 0) {
                        historyIndex--;
                        imageInput.value = imageUrlHistory[historyIndex];
                    } else if (historyIndex === 0) {
                        historyIndex = -1;
                        messageInput.value = '';
                    }
                }
            });

            imageInput.show();
            
            imageInput.onDidAccept(async () => {
                imageInput.hide();
                await updateImageUrlHistory(imageUrls);

                let availableModels: string[] = [];
                let anyLocalKeys = false;
                if (localKeys.openai) {
                    availableModels = OPENAI_MODEL_NAMES.concat(OPENAI_O_SERIES);
                    anyLocalKeys = true;
                }
                if (localKeys.anthropic) {
                    availableModels = availableModels.concat(ANTHROPIC_MODEL_NAMES);
                    anyLocalKeys = true;
                }
                if (localKeys.openrouter) {
                    availableModels = availableModels.concat(OPENROUTER_MODEL_NAMES, OPENROUTER_LONG_LIST, OPENROUTER_VISION_SUPPORT);
                    anyLocalKeys = true;
                }

                const models = isPaidUser ? OPENAI_O_SERIES.concat(OPENAI_MODEL_NAMES, ANTHROPIC_MODEL_NAMES, OPENROUTER_MODEL_NAMES, OPENROUTER_LONG_LIST, OPENROUTER_VISION_SUPPORT) :
                anyLocalKeys ? availableModels : OPENAI_MODEL_NAMES.concat(ANTHROPIC_MODEL_NAMES);

                const modelSelection = vscode.window.createQuickPick();
                modelSelection.title = "Build user input (3/3)";
                modelSelection.placeholder = `Select models to check (${(isPaidUser || anyLocalKeys) ? 'multi-select' : 'max 5'})`;
                modelSelection.canSelectMany = true;
                modelSelection.buttons = [];                 
                lastSelectedModels = context.globalState.get('lastSelectedModels', []);
                modelSelection.items = models.sort((a, b) => {
                    if (lastSelectedModels.includes(a) && !lastSelectedModels.includes(b)) {return -1;}
                    if (!lastSelectedModels.includes(a) && lastSelectedModels.includes(b)) {return 1;}
                    return 0;
                }).map(model => ({ 
                    label: model,     
                    picked: lastSelectedModels.includes(model)
                }));
                modelSelection.selectedItems = modelSelection.items.filter(item => lastSelectedModels.includes(item.label));
                modelSelection.show();

                let selectedModels: string[] = [];

                modelSelection.onDidChangeSelection(async (selection) => {
                    selectedModels = selection.map(item => item.label);
                    if (selectedModels.length > 5 && !isPaidUser && !anyLocalKeys) {
                        selectedModels = selectedModels.slice(0, 5);
                    }
                });

                modelSelection.onDidAccept(async () => {
					await updateModelPreferences(selectedModels);
                    modelSelection.hide();
                    const panel = vscode.window.createWebviewPanel(
                        'apiResponse',
                        selectedText.slice(0, 30),
                        vscode.ViewColumn.Beside,
                        {
                            enableScripts: true,
                            enableCommandUris: true,
                        }
                    );
                    const statusBar = getStatusBarItem();
                    try {
                        // Show loading in both status bar and panel
                        statusBar.text = "$(sync~spin) Processing request...";
                        statusBar.show();
            
                        panel.webview.html = `
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <style>
                                    .loading {
                                        font-family: var(--vscode-editor-font-family);
                                        padding: 16px;
                                    }
                                    @keyframes ellipsis {
                                        0% { content: ""; }
                                        25% { content: "."; }
                                        50% { content: ".."; }
                                        75% { content: "..."; }
                                        100% { content: ""; }
                                    }
                                    .dots::after {
                                        content: "";
                                        animation: ellipsis 2s infinite;
                                        display: inline-block;
                                        width: 20px;
                                    }
                                </style>
                            </head>
                            <body>
                                <div class="loading">
                                    Processing request<span class="dots"></span>
                                </div>
                                ${selectedModels.includes("deepseek/deepseek-r1") ? `<div class="loading">Reasoning models may take longer to respond, ~1 minute.</div>` : ''}
                            </body>
                            </html>
                        `;
                        let result;
                        const imageInput = imageUrls ? imageUrls.split(',').map(url => url.trim()) : [];
                        if (localKeys.openai || localKeys.anthropic || localKeys.openrouter) {
                            const response = await processLocalKeys(selectedText, selectedModels, [userMessage], imageInput, localKeys);
                            result = response;
                        } else {
                            const response = await fetch('https://server.promptoctopus.com/extension', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${isPaidUser ? apiKey : uuid}`, 'X-Custom-Header': 'MyVSCodeExtension' },
                                body: JSON.stringify({ 
                                    systemPrompt: selectedText, 
                                    models: selectedModels, 
                                    userMessages: [userMessage],
                                    imageUrls: imageInput,
                                    paidUser: isPaidUser,
                                    token: isPaidUser ? apiKey : uuid
                                }),
                            });
                        
            
                            if (!response.ok) {
                                throw new Error(`API Error: ${response.statusText}`);
                            }
                            result = await response.json();

                        }
                        requestCount++;
                        await context.globalState.update('requestCount', requestCount);
        
                        // Create a formatted response
                        const inputString = "input: " + userMessage + (imageUrls && imageUrls.trim() !== '' ? '\n\n' + "image urls: " + imageUrls + '\n\n' : '\n\n');
                        const formattedResponse = inputString + selectedModels
                            .map(model => `${model}:\n${result[model]}`)
                            .join('\n\n');
                        
                        // Update the panel with the response
                        panel.webview.html = `
                            <!DOCTYPE html>
                            <html>
                            <body style="padding: 16px;">
                                <pre style="white-space: pre-wrap; font-family: var(--vscode-editor-font-family);">${formattedResponse}</pre>
                            </body>
                            </html>
                        `;
                        statusBar.hide();

                    } catch (error) {
                        vscode.window.showErrorMessage(`Error: ${error}`);
                        // close the panel
                        panel.dispose();
                        // close status bar
                        statusBar.hide();
                    }
                });
            });
        });
        messageInput.show(); 
    });

    context.subscriptions.push(disposable);

    // Clean up the status bar hint on deactivate
    context.subscriptions.push({
        dispose: () => {
            hideHint();
        },
    });
}

export function deactivate() {}

