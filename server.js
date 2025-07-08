// api/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { URLSearchParams } = require('url');
const path = require('path');

const app = express();

// Налаштування CORS для Vercel
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());

// Обслуговування статичних файлів з папки 'public'
app.use(express.static(path.join(__dirname, 'public')));

class HdRezkaStream {
    constructor(season, episode) {
        this.videos = {};
        this.season = season;
        this.episode = episode;
    }

    append(resolution, link) {
        this.videos[resolution] = link;
    }
}

class HdRezkaApi {
    constructor(url, cookie = null) {
        this.frag = null;
        const index = url.indexOf("#");
        if (index !== -1) {
            const fragment = url.substring(index + 1);
            this.frag = fragment.match(/\d+/g);
        }
        this.cookie = cookie;
        
        this.url = url.split(".html")[0] + ".html";

        const urlObject = new URL(url);
        const origin = urlObject.origin;

        // Більш реалістичні заголовки
        this.PAGE_HEADERS = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        };

        this.AJAX_HEADERS = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
            'Accept-Encoding': 'gzip, deflate, br',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': this.url,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': origin,
            'DNT': '1',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };

        if (this.cookie) {
            this.PAGE_HEADERS['Cookie'] = this.cookie;
            this.AJAX_HEADERS['Cookie'] = this.cookie;
        }

        this.page = null;
        this.soup = null;
        this.id = null;
        this.name = null;
        this.type = null;
        this.translators = null;
        this.seriesInfo = null;
    }

    async login(login, password) {
        try {
            const loginData = new URLSearchParams({
                login_name: login,
                login_password: password,
                login_not_save: '0'
            }).toString();

            const response = await axios.post("https://hdrezka.ag/ajax/login/", loginData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://hdrezka.ag/',
                    'User-Agent': this.PAGE_HEADERS['User-Agent'],
                    'Origin': 'https://hdrezka.ag',
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                },
                timeout: 30000
            });

            if (response.data.success) {
                const cookies = response.headers['set-cookie'];
                if (cookies) {
                    const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
                    return { success: true, cookie: cookieString };
                }
            }
            return { success: false, message: response.data.message || 'Помилка авторизації' };
        } catch (error) {
            console.error('Помилка авторизації:', error.response?.data || error.message);
            return { success: false, message: `Помилка авторизації: ${error.message}` };
        }
    }

    async init() {
        try {
            console.log('Ініціалізація API для URL:', this.url);
            
            const response = await axios.get(this.url, { 
                headers: this.PAGE_HEADERS,
                timeout: 30000,
                maxRedirects: 5
            });
            
            console.log('Отримано відповідь, статус:', response.status);
            
            this.page = response.data;
            this.soup = cheerio.load(this.page);
            
            this.id = this.extractId();
            this.name = this.getName();
            this.type = this.getType();
            
            console.log('Успішно ініціалізовано:', { id: this.id, name: this.name, type: this.type });
            
            if (!this.id) {
                throw new Error('Не вдалося знайти ID контенту на сторінці');
            }
            
            return true;
        } catch (error) {
            console.error('Помилка ініціалізації:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                url: this.url
            });
            return false;
        }
    }

    extractId() {
        const postId = this.soup('#post_id');
        if (postId.length > 0) {
            return postId.attr('value');
        }
        
        // Альтернативний спосіб пошуку ID
        const scriptText = this.page;
        const match = scriptText.match(/sof\.tv\.initCDN[^(]*\(([^,]+)/);
        if (match) {
            return match[1].replace(/['"]/g, '');
        }
        
        return null;
    }

    getName() {
        const title = this.soup('.b-post__title');
        if (title.length > 0) {
            return title.text().trim();
        }
        
        const h1 = this.soup('h1');
        if (h1.length > 0) {
            return h1.text().trim();
        }
        
        return 'Невідома назва';
    }

    getType() {
        const meta = this.soup('meta[property="og:type"]');
        if (meta.length > 0) {
            return meta.attr('content');
        }
        
        // Альтернативний спосіб визначення типу
        if (this.page.includes('initCDNSeriesEvents')) {
            return 'video.tv_series';
        } else if (this.page.includes('initCDNMoviesEvents')) {
            return 'video.movie';
        }
        
        return 'video.movie'; // за замовчуванням
    }

    static clearTrash(data) {
        const trashList = ["@", "#", "!", "^", "$"];
        const trashCodesSet = [];
        
        for (let i = 2; i < 4; i++) {
            const chars = HdRezkaApi.generateCombinations(trashList, i);
            for (const combo of chars) {
                const trashcombo = Buffer.from(combo.join(''), 'utf8').toString('base64');
                trashCodesSet.push(trashcombo);
            }
        }

        const arr = data.replace("#h", "").split("//_//");
        let trashString = arr.join('');

        for (const trashCode of trashCodesSet) {
            trashString = trashString.replace(new RegExp(trashCode, 'g'), '');
        }

        try {
            const finalString = Buffer.from(trashString + "==", 'base64').toString('utf8');
            return finalString;
        } catch (error) {
            console.error('Помилка декодування:', error.message);
            return '';
        }
    }

    static generateCombinations(arr, length) {
        const result = [];
        const generate = (current, remaining) => {
            if (remaining === 0) {
                result.push([...current]);
                return;
            }
            for (const item of arr) {
                current.push(item);
                generate(current, remaining - 1);
                current.pop();
            }
        };
        generate([], length);
        return result;
    }

    async getTranslations() {
        const arr = {};
        const translators = this.soup('#translators-list');
        
        if (translators.length > 0) {
            const children = translators.children();
            children.each((i, child) => {
                const text = this.soup(child).text();
                const translatorId = this.soup(child).attr('data-translator_id');
                if (text && translatorId) {
                    arr[text] = translatorId;
                }
            });
        }

        if (Object.keys(arr).length === 0) {
            const getTranslationName = () => {
                const table = this.soup('.b-post__info');
                const rows = table.find('tr');
                for (let i = 0; i < rows.length; i++) {
                    const row = this.soup(rows[i]);
                    const text = row.text();
                    if (text.includes('переводе')) {
                        return text.split('В переводе:')[1]?.trim() || 'Невідомо';
                    }
                }
                return 'Оригінал';
            };

            const getTranslationID = () => {
                const initCDNEvents = {
                    'video.tv_series': 'initCDNSeriesEvents',
                    'video.movie': 'initCDNMoviesEvents'
                };
                
                try {
                    const scriptText = this.page;
                    const pattern = new RegExp(`sof\\.tv\\.${initCDNEvents[this.type]}.*?\\((.*?)\\)`, 'g');
                    const match = pattern.exec(scriptText);
                    if (match) {
                        const params = match[1].split(',');
                        return params[1]?.trim().replace(/['"]/g, '') || '1'; 
                    }
                } catch (error) {
                    console.error('Помилка отримання ID перекладу:', error.message);
                }
                return '1';
            };

            arr[getTranslationName()] = getTranslationID();
        }

        this.translators = arr;
        return arr;
    }

    static getEpisodes(seasonsHtml, episodesHtml) {
        const seasons$ = cheerio.load(seasonsHtml);
        const episodes$ = cheerio.load(episodesHtml);

        const seasons = {};
        seasons$('.b-simple_season__item').each((i, el) => {
            const tabId = seasons$(el).attr('data-tab_id');
            const text = seasons$(el).text();
            if (tabId && text) {
                seasons[tabId] = text;
            }
        });

        const episodes = {};
        episodes$('.b-simple_episode__item').each((i, el) => {
            const seasonId = episodes$(el).attr('data-season_id');
            const episodeId = episodes$(el).attr('data-episode_id');
            const text = episodes$(el).text();
            
            if (seasonId && episodeId && text) {
                if (!episodes[seasonId]) {
                    episodes[seasonId] = {};
                }
                episodes[seasonId][episodeId] = text;
            }
        });

        return { seasons, episodes };
    }

    async getSeasons() {
        if (!this.translators) {
            await this.getTranslations();
        }

        const arr = {};
        
        for (const [translatorName, translatorId] of Object.entries(this.translators)) {
            try {
                const postData = new URLSearchParams({
                    id: this.id,
                    translator_id: translatorId,
                    action: "get_episodes"
                }).toString();

                const response = await axios.post("https://rezka.ag/ajax/get_cdn_series/", postData, { 
                    headers: this.AJAX_HEADERS,
                    timeout: 30000
                });

                if (response.data.success) {
                    const { seasons, episodes } = HdRezkaApi.getEpisodes(
                        response.data.seasons, 
                        response.data.episodes
                    );
                    
                    arr[translatorName] = {
                        translator_id: translatorId,
                        seasons: seasons,
                        episodes: episodes
                    };
                }
            } catch (error) {
                console.error(`Помилка отримання сезонів для ${translatorName}:`, error.message);
            }
        }

        this.seriesInfo = arr;
        return arr;
    }

    async getStream(season = null, episode = null, translation = null, index = 0) {
        const makeRequest = async (data) => {
            try {
                const postData = new URLSearchParams(data).toString();

                const response = await axios.post("https://rezka.ag/ajax/get_cdn_series/", postData, { 
                    headers: this.AJAX_HEADERS,
                    timeout: 30000
                });

                if (response.data.success) {
                    if (typeof response.data.url !== 'string' || !response.data.url) {
                        throw new Error('Контент недоступний у вашому регіоні або потрібна авторизація');
                    }

                    const cleanedUrl = HdRezkaApi.clearTrash(response.data.url);
                    const arr = cleanedUrl.split(",");
                    const stream = new HdRezkaStream(season, episode);
                    
                    for (const item of arr) {
                        try {
                            const resMatch = item.match(/\[([^\]]+)\]/);
                            const urlMatch = item.match(/\]([^[]+?)(?:\s+or\s+([^[]+))?$/);
                            
                            if (resMatch && urlMatch) {
                                const resolution = resMatch[1];
                                const videoUrl = urlMatch[2] || urlMatch[1]; 
                                stream.append(resolution.trim(), videoUrl.trim());
                            }
                        } catch (error) {
                            console.error('Помилка парсингу відео:', error.message);
                        }
                    }
                    
                    return stream;
                }
            } catch (error) {
                console.error('Помилка запиту відео:', error.message);
                throw error;
            }
            return null;
        };

        if (!this.translators) {
            await this.getTranslations();
        }

        let trId;
        if (translation) {
            if (!isNaN(translation) && Object.values(this.translators).includes(translation.toString())) {
                 trId = translation.toString();
            } else if (this.translators[translation]) {
                trId = this.translators[translation];
            } else {
                throw new Error(`Переклад "${translation}" не знайдено`);
            }
        } else {
            trId = Object.values(this.translators)[index];
        }

        if (this.type === "video.tv_series") {
            if (!season || !episode) {
                throw new Error("Для серіалу потрібно вказати сезон і серію");
            }

            if (!this.seriesInfo) {
                await this.getSeasons();
            }
            
            return await makeRequest({
                id: this.id,
                translator_id: trId,
                season: season.toString(),
                episode: episode.toString(),
                action: "get_stream"
            });

        } else if (this.type === "video.movie") {
            return await makeRequest({
                id: this.id,
                translator_id: trId,
                action: "get_movie"
            });
        } else {
            throw new Error("Невідомий тип контенту");
        }
    }
}

// API Routes
app.post('/api/parse', async (req, res) => {
    try {
        console.log('Запит на парсинг:', req.body);
        const { url, cookie } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL обов\'язковий' });
        }

        const api = new HdRezkaApi(url, cookie);
        const success = await api.init();
        
        if (!success) {
            return res.status(500).json({ error: 'Не вдалося ініціалізувати API. Перевірте URL або доступ до сайту.' });
        }

        const translations = await api.getTranslations();
        let seasonsInfo = null;
        
        if (api.type === 'video.tv_series') {
            seasonsInfo = await api.getSeasons();
        }

        const result = {
            id: api.id,
            name: api.name,
            type: api.type,
            translations: translations,
            seasons: seasonsInfo
        };

        console.log('Успішно спарсено:', result);
        res.json(result);
    } catch (error) {
        console.error('Помилка в /api/parse:', error);
        res.status(500).json({ error: `Помилка парсингу: ${error.message}` });
    }
});

app.post('/api/stream', async (req, res) => {
    try {
        console.log('Запит на стрім:', req.body);
        const { url, season, episode, translation, cookie } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL обов\'язковий' });
        }

        const api = new HdRezkaApi(url, cookie);
        const success = await api.init();
        
        if (!success) {
            return res.status(500).json({ error: 'Не вдалося ініціалізувати API для стріму' });
        }

        const stream = await api.getStream(season, episode, translation);
        
        if (!stream || Object.keys(stream.videos).length === 0) {
            return res.status(404).json({ error: 'Відео не знайдено' });
        }

        res.json({
            videos: stream.videos,
            season: stream.season,
            episode: stream.episode
        });
    } catch (error) {
        console.error('Помилка в /api/stream:', error);
        res.status(500).json({ error: `Помилка отримання стріму: ${error.message}` });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        if (!login || !password) {
            return res.status(400).json({ error: 'Логін та пароль обов\'язкові' });
        }

        const api = new HdRezkaApi('https://hdrezka.ag/');
        const loginResult = await api.login(login, password);

        if (loginResult.success) {
            res.json({ success: true, cookie: loginResult.cookie });
        } else {
            res.status(401).json({ success: false, error: loginResult.message });
        }
    } catch (error) {
        console.error('Помилка в /api/login:', error);
        res.status(500).json({ error: `Помилка авторизації: ${error.message}` });
    }
});

// Обробка 404 - коли жоден маршрут не підійшов
app.use((req, res, next) => {
    res.status(404).json({ error: `Маршрут ${req.method} ${req.path} не знайдено` });
});

// Глобальний обробник помилок (має бути останнім)
app.use((err, req, res, next) => {
    console.error('Глобальна помилка сервера:', err.stack);
    res.status(500).json({ error: 'Внутрішня помилка сервера. Перевірте логи на Vercel.' });
});

// Експорт для Vercel
module.exports = app;

// Для локального запуску
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Сервер запущено на порту ${PORT}`);
    });
}