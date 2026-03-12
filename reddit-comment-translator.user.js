// ==UserScript==
// @name         Reddit Comment Translator
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Translate Reddit comments with configurable providers, including BYOK OpenAI-compatible APIs.
// @author       You
// @match        https://www.reddit.com/*
// @match        https://old.reddit.com/*
// @match        https://new.reddit.com/*
// @match        https://sh.reddit.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    const CONFIG = {
        BUTTON_CLASS: 'gm-translate-btn',
        TRANSLATION_CLASS: 'gm-translation-result',
        PROCESSED_ATTR: 'data-gm-translate-processed',
        MAX_TEXT_LENGTH: 5000,
        CACHE_SIZE: 120,
        REQUEST_TIMEOUT: 20000,
        RETRY_ATTEMPTS: 2,
        RETRY_DELAY: 1200,
        INITIAL_DELAY: 1200,
        OBSERVER_DEBOUNCE_MS: 150
    };

    const STORAGE_KEYS = {
        SETTINGS: 'redditTranslator.settings',
        CACHE: 'redditTranslator.cache.v1'
    };

    const PROVIDERS = {
        google: 'google',
        openai: 'openai'
    };

    const PROVIDER_LABELS = {
        [PROVIDERS.google]: 'Google',
        [PROVIDERS.openai]: 'OpenAI Compatible'
    };

    const DEFAULT_SETTINGS = {
        provider: PROVIDERS.google,
        targetLang: 'zh-CN',
        openaiEndpoint: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: '',
        openaiModel: 'gpt-4o-mini',
        openaiSystemPrompt: [
            'Translate the provided Reddit comment into Simplified Chinese.',
            'Return only the translation.',
            'Preserve Markdown, quotes, bullets, line breaks, links, and code blocks.',
            'Do not explain, summarize, or add notes.'
        ].join(' ')
    };

    const STATE = {
        initialized: false,
        settings: null,
        cache: null
    };

    function log(...args) {
        if (DEBUG) {
            console.log('[Reddit Translator]', ...args);
        }
    }

    function loadSettings() {
        const raw = GM_getValue(STORAGE_KEYS.SETTINGS, '');
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }

        try {
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_SETTINGS, ...parsed };
        } catch (error) {
            console.error('[Reddit Translator] Failed to parse saved settings:', error);
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(partialSettings) {
        STATE.settings = { ...STATE.settings, ...partialSettings };
        GM_setValue(STORAGE_KEYS.SETTINGS, JSON.stringify(STATE.settings));
    }

    class TranslationCache {
        constructor(maxSize = CONFIG.CACHE_SIZE) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }

        load() {
            const raw = GM_getValue(STORAGE_KEYS.CACHE, '[]');
            try {
                const entries = JSON.parse(raw);
                if (Array.isArray(entries)) {
                    this.cache = new Map(entries);
                }
            } catch (error) {
                console.error('[Reddit Translator] Failed to parse cache:', error);
                this.cache = new Map();
            }
        }

        persist() {
            const entries = Array.from(this.cache.entries()).slice(-this.maxSize);
            GM_setValue(STORAGE_KEYS.CACHE, JSON.stringify(entries));
        }

        generateKey(text, settings) {
            const prefix = [
                settings.provider,
                settings.targetLang,
                settings.openaiModel,
                normalizeEndpoint(settings.openaiEndpoint)
            ].join('|');
            const input = `${prefix}|${text.substring(0, 300)}|${text.length}`;
            let hash = 0;
            for (let i = 0; i < input.length; i++) {
                hash = ((hash << 5) - hash) + input.charCodeAt(i);
                hash |= 0;
            }
            return `${hash}_${input.length}`;
        }

        get(text, settings) {
            const key = this.generateKey(text, settings);
            if (!this.cache.has(key)) {
                return null;
            }

            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        set(text, settings, translation) {
            const key = this.generateKey(text, settings);
            if (this.cache.has(key)) {
                this.cache.delete(key);
            }
            this.cache.set(key, translation);

            while (this.cache.size > this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }

            this.persist();
        }

        clear() {
            this.cache.clear();
            this.persist();
        }
    }

    function normalizeEndpoint(endpoint) {
        const value = (endpoint || '').trim();
        if (!value) {
            return DEFAULT_SETTINGS.openaiEndpoint;
        }

        const trimmed = value.replace(/\/+$/, '');
        if (trimmed.endsWith('/chat/completions')) {
            return trimmed;
        }
        if (trimmed.endsWith('/v1')) {
            return `${trimmed}/chat/completions`;
        }
        if (/\/v\d+$/.test(trimmed)) {
            return `${trimmed}/chat/completions`;
        }
        if (trimmed.includes('/chat/completions')) {
            return trimmed;
        }
        return `${trimmed}/v1/chat/completions`;
    }

    function promptForSetting(label, currentValue, placeholder = '') {
        const promptMessage = placeholder
            ? `${label}\n当前值: ${currentValue || '(空)'}\n示例: ${placeholder}`
            : `${label}\n当前值: ${currentValue || '(空)'}`;
        const value = window.prompt(promptMessage, currentValue || '');
        if (value === null) {
            return null;
        }
        return value.trim();
    }

    function registerMenuCommands() {
        GM_registerMenuCommand(`切换翻译服务 (${PROVIDER_LABELS[STATE.settings.provider]})`, () => {
            const choice = promptForSetting(
                '输入翻译服务: google 或 openai',
                STATE.settings.provider,
                'google'
            );

            if (!choice) {
                return;
            }

            if (!Object.values(PROVIDERS).includes(choice)) {
                window.alert('无效的 provider。可选值: google / openai');
                return;
            }

            saveSettings({ provider: choice });
            window.alert(`翻译服务已切换为: ${PROVIDER_LABELS[choice]}`);
        });

        GM_registerMenuCommand(`设置目标语言 (${STATE.settings.targetLang})`, () => {
            const value = promptForSetting(
                '输入目标语言代码，例如 zh-CN / zh-TW / ja / en',
                STATE.settings.targetLang,
                'zh-CN'
            );
            if (!value) {
                return;
            }
            saveSettings({ targetLang: value });
            window.alert(`目标语言已更新为: ${value}`);
        });

        GM_registerMenuCommand('设置 OpenAI Compatible Endpoint', () => {
            const value = promptForSetting(
                '输入聊天补全接口地址',
                STATE.settings.openaiEndpoint,
                'https://api.openai.com/v1/chat/completions'
            );
            if (!value) {
                return;
            }
            const normalized = normalizeEndpoint(value);
            saveSettings({ openaiEndpoint: normalized });
            window.alert(`Endpoint 已更新为:\n${normalized}`);
        });

        GM_registerMenuCommand(
            `设置 OpenAI Compatible API Key (${STATE.settings.openaiApiKey ? '已配置' : '未配置'})`,
            () => {
                const value = promptForSetting(
                    '输入 API Key。留空并确认可清空。',
                    STATE.settings.openaiApiKey,
                    'sk-...'
                );
                if (value === null) {
                    return;
                }
                saveSettings({ openaiApiKey: value });
                window.alert(value ? 'API Key 已保存。' : 'API Key 已清空。');
            }
        );

        GM_registerMenuCommand(`设置 OpenAI Compatible 模型 (${STATE.settings.openaiModel})`, () => {
            const value = promptForSetting(
                '输入模型名',
                STATE.settings.openaiModel,
                'gpt-4o-mini'
            );
            if (!value) {
                return;
            }
            saveSettings({ openaiModel: value });
            window.alert(`模型已更新为: ${value}`);
        });

        GM_registerMenuCommand('清空翻译缓存', () => {
            STATE.cache.clear();
            window.alert('缓存已清空。');
        });

        GM_registerMenuCommand('查看当前配置', () => {
            const summary = [
                `Provider: ${PROVIDER_LABELS[STATE.settings.provider]}`,
                `Target Language: ${STATE.settings.targetLang}`,
                `Endpoint: ${STATE.settings.openaiEndpoint}`,
                `Model: ${STATE.settings.openaiModel}`,
                `API Key: ${STATE.settings.openaiApiKey ? '已配置' : '未配置'}`
            ].join('\n');
            window.alert(summary);
        });
    }

    function injectStyles() {
        const css = `
            .${CONFIG.BUTTON_CLASS} {
                background: transparent !important;
                border: none !important;
                color: #878a8c !important;
                font-size: 12px !important;
                font-weight: 700 !important;
                line-height: 16px !important;
                padding: 4px 8px !important;
                margin: 0 4px !important;
                cursor: pointer !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                display: inline-flex !important;
                align-items: center !important;
                vertical-align: middle !important;
                border-radius: 999px !important;
                transition: background-color 0.15s, color 0.15s !important;
                text-transform: none !important;
            }
            .${CONFIG.BUTTON_CLASS}:hover {
                background-color: rgba(128, 128, 128, 0.15) !important;
                color: #1a1a1b !important;
            }
            .${CONFIG.BUTTON_CLASS}:disabled {
                opacity: 0.6 !important;
                cursor: wait !important;
            }
            .${CONFIG.BUTTON_CLASS}--loading::after {
                content: '' !important;
                width: 10px !important;
                height: 10px !important;
                margin-left: 6px !important;
                border: 2px solid transparent !important;
                border-top-color: currentColor !important;
                border-radius: 50% !important;
                animation: gm-spin 0.8s linear infinite !important;
            }
            @keyframes gm-spin {
                to { transform: rotate(360deg); }
            }
            .${CONFIG.TRANSLATION_CLASS} {
                margin: 10px 0 !important;
                padding: 12px 16px !important;
                background: linear-gradient(135deg, rgba(0, 121, 211, 0.08) 0%, rgba(0, 121, 211, 0.03) 100%) !important;
                border-left: 3px solid #0079d3 !important;
                border-radius: 8px !important;
                color: #1c1c1c !important;
                font-size: 14px !important;
                line-height: 1.6 !important;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
            }
            [data-theme="dark"] .${CONFIG.TRANSLATION_CLASS},
            .theme-dark .${CONFIG.TRANSLATION_CLASS} {
                background: linear-gradient(135deg, rgba(0, 121, 211, 0.15) 0%, rgba(0, 121, 211, 0.08) 100%) !important;
                color: #d7dadc !important;
            }
            .${CONFIG.TRANSLATION_CLASS}::before {
                content: attr(data-label) !important;
                display: block !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: #0079d3 !important;
                margin-bottom: 8px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
            }
            .${CONFIG.TRANSLATION_CLASS}--truncated::after {
                content: '文本过长，仅翻译前 5000 字符' !important;
                display: block !important;
                margin-top: 8px !important;
                padding-top: 8px !important;
                border-top: 1px dashed rgba(0, 121, 211, 0.2) !important;
                font-size: 11px !important;
                color: #ff8800 !important;
                font-style: italic !important;
            }
            .${CONFIG.TRANSLATION_CLASS}--error {
                border-left-color: #ff4444 !important;
                background: linear-gradient(135deg, rgba(255, 68, 68, 0.08) 0%, rgba(255, 68, 68, 0.03) 100%) !important;
            }
            .${CONFIG.TRANSLATION_CLASS}--error::before {
                color: #ff4444 !important;
            }
        `;

        GM_addStyle(css);
        log('Styles injected');
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function shouldRetryStatus(status) {
        return status === 408 || status === 429 || status >= 500;
    }

    function requestGM(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: CONFIG.REQUEST_TIMEOUT,
                ...options,
                onload: resolve,
                onerror: reject,
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }

    async function translateWithGoogle(text, settings, attempt = 0) {
        const wasTruncated = text.length > CONFIG.MAX_TEXT_LENGTH;
        const textToTranslate = text.substring(0, CONFIG.MAX_TEXT_LENGTH);

        const params = new URLSearchParams({
            client: 'gtx',
            sl: 'auto',
            tl: settings.targetLang,
            dt: 't',
            dj: '1',
            q: textToTranslate
        });

        const url = `https://translate.googleapis.com/translate_a/single?${params}`;

        try {
            const response = await requestGM({
                method: 'GET',
                url,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            if (response.status !== 200) {
                if (attempt < CONFIG.RETRY_ATTEMPTS && shouldRetryStatus(response.status)) {
                    await wait(CONFIG.RETRY_DELAY * (attempt + 1));
                    return translateWithGoogle(text, settings, attempt + 1);
                }
                throw new Error(`Google 翻译请求失败: HTTP ${response.status}`);
            }

            const data = JSON.parse(response.responseText);
            let translatedText = '';

            if (data.sentences && Array.isArray(data.sentences)) {
                for (const sentence of data.sentences) {
                    if (sentence.trans) {
                        translatedText += sentence.trans;
                    }
                }
            } else if (Array.isArray(data) && Array.isArray(data[0])) {
                for (const segment of data[0]) {
                    if (segment && segment[0]) {
                        translatedText += segment[0];
                    }
                }
            } else if (typeof data === 'string') {
                translatedText = data;
            }

            if (!translatedText.trim()) {
                throw new Error('Google 翻译返回了空结果');
            }

            return {
                text: translatedText.trim(),
                truncated: wasTruncated,
                provider: PROVIDERS.google,
                providerLabel: PROVIDER_LABELS[PROVIDERS.google]
            };
        } catch (error) {
            if (attempt < CONFIG.RETRY_ATTEMPTS && error.message === 'timeout') {
                await wait(CONFIG.RETRY_DELAY * (attempt + 1));
                return translateWithGoogle(text, settings, attempt + 1);
            }
            throw error.message === 'timeout'
                ? new Error('Google 翻译请求超时，请稍后重试')
                : error;
        }
    }

    function extractOpenAIContent(payload) {
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === 'string') {
                        return part;
                    }
                    if (part?.type === 'text') {
                        return part.text || '';
                    }
                    return '';
                })
                .join('')
                .trim();
        }
        return '';
    }

    async function translateWithOpenAICompatible(text, settings, attempt = 0) {
        const endpoint = normalizeEndpoint(settings.openaiEndpoint);
        const apiKey = settings.openaiApiKey.trim();
        const model = settings.openaiModel.trim();

        if (!apiKey) {
            throw new Error('请先在 Tampermonkey 菜单中配置 OpenAI Compatible API Key');
        }
        if (!model) {
            throw new Error('请先在 Tampermonkey 菜单中配置 OpenAI Compatible 模型');
        }

        const wasTruncated = text.length > CONFIG.MAX_TEXT_LENGTH;
        const textToTranslate = text.substring(0, CONFIG.MAX_TEXT_LENGTH);

        const payload = {
            model,
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: settings.openaiSystemPrompt
                },
                {
                    role: 'user',
                    content: `Target language: ${settings.targetLang}\n\nText:\n${textToTranslate}`
                }
            ]
        };

        try {
            const response = await requestGM({
                method: 'POST',
                url: endpoint,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify(payload)
            });

            if (response.status !== 200) {
                if (attempt < CONFIG.RETRY_ATTEMPTS && shouldRetryStatus(response.status)) {
                    await wait(CONFIG.RETRY_DELAY * (attempt + 1));
                    return translateWithOpenAICompatible(text, settings, attempt + 1);
                }

                let message = `HTTP ${response.status}`;
                try {
                    const errorPayload = JSON.parse(response.responseText);
                    message = errorPayload?.error?.message || message;
                } catch (error) {
                    log('Failed to parse OpenAI-compatible error payload', error);
                }

                throw new Error(`AI 翻译请求失败: ${message}`);
            }

            const data = JSON.parse(response.responseText);
            const translatedText = extractOpenAIContent(data);

            if (!translatedText) {
                throw new Error('AI 翻译返回了空结果');
            }

            return {
                text: translatedText,
                truncated: wasTruncated,
                provider: PROVIDERS.openai,
                providerLabel: PROVIDER_LABELS[PROVIDERS.openai]
            };
        } catch (error) {
            if (attempt < CONFIG.RETRY_ATTEMPTS && error.message === 'timeout') {
                await wait(CONFIG.RETRY_DELAY * (attempt + 1));
                return translateWithOpenAICompatible(text, settings, attempt + 1);
            }
            throw error.message === 'timeout'
                ? new Error('AI 翻译请求超时，请稍后重试')
                : error;
        }
    }

    async function translateText(text) {
        if (!text || !text.trim()) {
            throw new Error('没有可翻译的文本');
        }

        const cached = STATE.cache.get(text, STATE.settings);
        if (cached) {
            return {
                ...cached,
                fromCache: true
            };
        }

        let result;
        if (STATE.settings.provider === PROVIDERS.openai) {
            result = await translateWithOpenAICompatible(text, STATE.settings);
        } else {
            result = await translateWithGoogle(text, STATE.settings);
        }

        STATE.cache.set(text, STATE.settings, result);
        return {
            ...result,
            fromCache: false
        };
    }

    function findCommentContentArea(commentEl) {
        const selectors = [
            'div[slot="comment"]',
            '[data-testid="comment"]',
            '.usertext-body .md',
            'div.md',
            '.md-container',
            'faceplate-partial[loading="lazy"]'
        ];

        for (const selector of selectors) {
            const found = commentEl.querySelector(selector);
            if (found && !found.classList?.contains(CONFIG.TRANSLATION_CLASS)) {
                return found;
            }
        }

        return null;
    }

    function sanitizeContentClone(contentEl) {
        const clone = contentEl.cloneNode(true);
        const junkSelectors = [
            `.${CONFIG.TRANSLATION_CLASS}`,
            `.${CONFIG.BUTTON_CLASS}`,
            'button',
            'shreddit-comment-action-row',
            '[slot="action-row"]',
            '[data-testid="comment-top-meta"]',
            '.tagline',
            '.buttons',
            '.flat-list',
            'faceplate-screen-reader-content'
        ];

        for (const selector of junkSelectors) {
            clone.querySelectorAll(selector).forEach((node) => node.remove());
        }

        return clone;
    }

    function extractCommentText(commentEl) {
        const contentArea = findCommentContentArea(commentEl);
        if (contentArea) {
            const cleanClone = sanitizeContentClone(contentArea);
            const text = (cleanClone.innerText || cleanClone.textContent || '').trim();
            if (text.length > 0) {
                return text;
            }
        }

        const fallback = commentEl.cloneNode(true);
        fallback.querySelectorAll(`.${CONFIG.TRANSLATION_CLASS}, .${CONFIG.BUTTON_CLASS}`).forEach((node) => node.remove());
        const text = (fallback.innerText || fallback.textContent || '').trim();
        return text || null;
    }

    function findInsertionPoint(commentEl) {
        const actionRowSelectors = [
            'shreddit-comment-action-row',
            'div[slot="action-row"]',
            'ul.flat-list.buttons',
            'div.buttons'
        ];

        for (const selector of actionRowSelectors) {
            const el = commentEl.querySelector(selector);
            if (el) {
                return { element: el, position: 'inside' };
            }
        }

        const replyBtn = commentEl.querySelector(
            'button[slot="reply-button"], button[aria-label*="Reply"], button[aria-label*="reply"], a.reply-button'
        );
        if (replyBtn?.parentElement) {
            return { element: replyBtn.parentElement, position: 'inside' };
        }

        const metadata = commentEl.querySelector(
            'div[data-testid="comment-top-meta"], div.tagline, div[class*="metadata"]'
        );
        if (metadata) {
            return { element: metadata, position: 'after' };
        }

        return { element: commentEl, position: 'prepend' };
    }

    function createTranslateButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = CONFIG.BUTTON_CLASS;
        btn.textContent = '翻译';
        btn.title = '翻译评论';
        btn.setAttribute('aria-label', '翻译评论');
        return btn;
    }

    function createResultBlock(message, options = {}) {
        const div = document.createElement('div');
        div.className = CONFIG.TRANSLATION_CLASS;
        div.textContent = message;
        div.dataset.label = options.label || '译文';

        if (options.error) {
            div.classList.add(`${CONFIG.TRANSLATION_CLASS}--error`);
        }
        if (options.truncated) {
            div.classList.add(`${CONFIG.TRANSLATION_CLASS}--truncated`);
        }

        return div;
    }

    function insertResultBlock(commentEl, block) {
        const contentArea = findCommentContentArea(commentEl);
        if (contentArea?.parentElement) {
            contentArea.parentElement.insertBefore(block, contentArea.nextSibling);
            return;
        }
        commentEl.appendChild(block);
    }

    async function handleButtonClick(event, button, commentEl) {
        event.preventDefault();
        event.stopPropagation();

        const existingTranslation = commentEl.querySelector(`.${CONFIG.TRANSLATION_CLASS}`);
        if (
            existingTranslation &&
            !existingTranslation.classList.contains(`${CONFIG.TRANSLATION_CLASS}--error`)
        ) {
            const isHidden = existingTranslation.style.display === 'none';
            existingTranslation.style.display = isHidden ? 'block' : 'none';
            button.textContent = isHidden ? '隐藏' : '翻译';
            return;
        }

        if (existingTranslation) {
            existingTranslation.remove();
        }

        const text = extractCommentText(commentEl);
        if (!text) {
            const errorBlock = createResultBlock('未能提取评论正文', {
                error: true,
                label: '翻译失败'
            });
            insertResultBlock(commentEl, errorBlock);
            button.textContent = '重试';
            return;
        }

        button.disabled = true;
        button.textContent = '翻译中';
        button.classList.add(`${CONFIG.BUTTON_CLASS}--loading`);

        try {
            const result = await translateText(text);
            const translationDiv = createResultBlock(result.text, {
                label: `译文 · ${result.providerLabel}`,
                truncated: result.truncated
            });
            insertResultBlock(commentEl, translationDiv);
            button.textContent = '隐藏';
        } catch (error) {
            console.error('[Reddit Translator] Error:', error);
            const errorDiv = createResultBlock(error.message || '翻译失败', {
                error: true,
                label: `翻译失败 · ${PROVIDER_LABELS[STATE.settings.provider]}`
            });
            insertResultBlock(commentEl, errorDiv);
            button.textContent = '重试';
            button.style.color = '#ff4444';
            setTimeout(() => {
                button.style.color = '';
            }, 3000);
        } finally {
            button.disabled = false;
            button.classList.remove(`${CONFIG.BUTTON_CLASS}--loading`);
        }
    }

    function processComment(commentEl) {
        if (!(commentEl instanceof Element)) {
            return false;
        }
        if (commentEl.hasAttribute(CONFIG.PROCESSED_ATTR)) {
            return false;
        }
        if (commentEl.querySelector(`.${CONFIG.BUTTON_CLASS}`)) {
            commentEl.setAttribute(CONFIG.PROCESSED_ATTR, 'true');
            return false;
        }

        const insertionPoint = findInsertionPoint(commentEl);
        if (!insertionPoint?.element) {
            return false;
        }

        const button = createTranslateButton();
        button.addEventListener('click', (event) => {
            handleButtonClick(event, button, commentEl);
        });

        const { element, position } = insertionPoint;

        if (position === 'inside') {
            if (element.tagName === 'UL') {
                const li = document.createElement('li');
                li.appendChild(button);
                element.appendChild(li);
            } else {
                element.appendChild(button);
            }
        } else if (position === 'after') {
            element.insertAdjacentElement('afterend', button);
        } else {
            element.prepend(button);
        }

        commentEl.setAttribute(CONFIG.PROCESSED_ATTR, 'true');
        return true;
    }

    function collectCommentElements(root) {
        const commentSet = new Set();
        const selectors = ['shreddit-comment', '.thing.comment', '[data-testid="comment"]'];

        if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) {
            return [];
        }

        if (root instanceof Element) {
            if (root.matches('shreddit-comment, .thing.comment')) {
                commentSet.add(root);
            } else if (root.matches('[data-testid="comment"]')) {
                commentSet.add(root.closest('div[id^="t1_"]') || root.closest('article') || root);
            }
        }

        selectors.forEach((selector) => {
            root.querySelectorAll(selector).forEach((el) => {
                if (selector === '[data-testid="comment"]') {
                    commentSet.add(el.closest('div[id^="t1_"]') || el.closest('article') || el);
                } else {
                    commentSet.add(el);
                }
            });
        });

        return Array.from(commentSet);
    }

    function processAllComments(root = document) {
        let processedCount = 0;
        collectCommentElements(root).forEach((commentEl) => {
            if (processComment(commentEl)) {
                processedCount++;
            }
        });

        if (processedCount > 0) {
            log(`Activated ${processedCount} new buttons`);
        }
    }

    function setupObserver() {
        let timer = null;
        let pendingNodes = [];

        const flush = () => {
            const nodes = pendingNodes;
            pendingNodes = [];
            const roots = new Set(nodes);
            roots.forEach((node) => processAllComments(node));
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof Element) {
                        pendingNodes.push(node);
                    }
                });
            }

            if (pendingNodes.length === 0) {
                return;
            }

            clearTimeout(timer);
            timer = setTimeout(flush, CONFIG.OBSERVER_DEBOUNCE_MS);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function init() {
        if (STATE.initialized) {
            return;
        }
        STATE.initialized = true;

        STATE.settings = loadSettings();
        STATE.cache = new TranslationCache();
        STATE.cache.load();

        injectStyles();
        registerMenuCommands();

        console.log('[Reddit Translator] Initializing v4.0.0...');
        setTimeout(() => {
            processAllComments(document);
            setupObserver();
        }, CONFIG.INITIAL_DELAY);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
