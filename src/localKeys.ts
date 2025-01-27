import { OPENAI_MODEL_NAMES, OPENAI_O_SERIES, ANTHROPIC_MODEL_NAMES, OPENROUTER_MODEL_NAMES, OPENROUTER_VISION_SUPPORT, OPENROUTER_LONG_LIST } from "./extension";

interface Message {
    role: string;
    content: string | { type: string; text?: string; image_url?: { url: string } }[];
}
interface AnthropicMessage {
    role: string;
    content: { type: string; text?: string; source?: { type: "base64"; media_type: string; data: string } }[];
}

interface LocalKeysResponse {
    [key: string]: string;
}

function getMediaType(imageUrl: string): string {
    const path = new URL(imageUrl).pathname;
    const extension = decodeURIComponent(path).split('.').pop()?.toLowerCase();
    
    if (extension === 'jpeg' || extension === 'jpg') {
        return "image/jpeg";
    } else if (extension === 'png') {
        return "image/png";
    } else {
        throw new Error(`Unsupported image format: ${extension}`);
    }
}

async function callOpenRouterModel(model: string, messages: Message[], apiKey: string): Promise<string> {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: messages,
            provider: {
                data_collection: "deny"
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Error calling OpenRouter API: ${response.status}, ${await response.text()}`);
    }

    const data: any = await response.json();
    if (!data.choices?.[0]?.message?.content) {
        throw new Error("Invalid response format from OpenRouter API");
    }

    return data.choices[0].message.content;
}

async function callOpenAIModel(model: string, messages: Message[], apiKey: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: messages
        })
    });

    if (!response.ok) {
        throw new Error(`Error calling OpenAI API: ${response.status}, ${await response.text()}`);
    }

    const data: any = await response.json();
    if (!data.choices?.[0]?.message?.content) {
        throw new Error("Invalid response format from OpenAI API");
    }

    return data.choices[0].message.content;
}

async function callAnthropicModel(model: string, messages: AnthropicMessage[], apiKey: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 1024,
            messages: messages
        })
    });

    if (!response.ok) {
        throw new Error(`Error calling Anthropic API: ${response.status}, ${await response.text()}`);
    }

    const data: any = await response.json();
    if (!data.content?.[0]?.text) {
        throw new Error("Invalid response format from Anthropic API");
    }

    return data.content[0].text;
}

export async function processLocalKeys(systemPrompt: string, models: string[], userMessages: string[], imageUrls: string[], keys: { openai: string | undefined, anthropic: string | undefined, openrouter: string | undefined }): Promise<LocalKeysResponse> {
    if (!systemPrompt || !models || !userMessages) {
        throw new Error("Missing required fields in the request");
    }

    const response: LocalKeysResponse = {};

    for (const model of models) {
        if (OPENAI_MODEL_NAMES.includes(model) || OPENAI_O_SERIES.includes(model)) {
            const messages: Message[] = [
                { role: OPENAI_O_SERIES.includes(model) ? "developer" : "system", content: systemPrompt }
            ];

            messages.push(...userMessages.map(msg => ({ role: "user", content: msg })));

            if (imageUrls.length > 0) {
                const imageContent = imageUrls.map(url => ({
                    type: "image_url",
                    image_url: { url }
                }));
                messages.push({ role: "user", content: imageContent });
            }

            try {
                if (!keys.openai) {
                    throw new Error("OpenAI API key not found");
                }
                response[model] = await callOpenAIModel(model, messages, keys.openai);
            } catch (e) {
                response[model] = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }

        } else if (ANTHROPIC_MODEL_NAMES.includes(model)) {
            try {
                const anthropicMessages: AnthropicMessage[] = userMessages.map(msg => ({
                    role: "user",
                    content: [{ type: "text", text: msg }]
                }));

                for (const imageUrl of imageUrls) {
                    try {
                        const mediaType = getMediaType(imageUrl);
                        const imageResponse = await fetch(imageUrl);
                        const imageArrayBuffer = await imageResponse.arrayBuffer();
                        const base64Data = Buffer.from(imageArrayBuffer).toString('base64');
                        
                        anthropicMessages.push({
                            role: "user",
                            content: [{
                                type: "image",
                                source: {
                                    type: "base64",
                                    media_type: mediaType,
                                    data: base64Data
                                }
                            }]
                        });
                    } catch (e) {
                        console.error(`Error processing image ${imageUrl}:`, e);
                    }
                }

                if (!keys.anthropic) {
                    throw new Error("Anthropic API key not found");
                }
                response[model] = await callAnthropicModel(model, anthropicMessages, keys.anthropic);
            } catch (e) {
                response[model] = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }

        } else if (OPENROUTER_MODEL_NAMES.includes(model) || OPENROUTER_LONG_LIST.includes(model) || OPENROUTER_VISION_SUPPORT.includes(model)) {
            try {
                const messages: Message[] = [{ role: "system", content: systemPrompt }];
                messages.push(...userMessages.map(msg => ({ role: "user", content: msg })));

                if (imageUrls.length > 0 && OPENROUTER_VISION_SUPPORT.includes(model)) {
                    const imageContent = imageUrls.map(url => ({
                        type: "image_url",
                        image_url: { url }
                    }));
                    messages.push({ role: "user", content: imageContent });
                }

                if (!keys.openrouter) {
                    throw new Error("OpenRouter API key not found");
                }

                response[model] = await callOpenRouterModel(model, messages, keys.openrouter);
            } catch (e) {
                response[model] = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        } else {
            response[model] = "Error: Model not recognized in either OpenAI or Anthropic.";
        }
    }

    return response;
}
