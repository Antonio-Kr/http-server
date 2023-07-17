const fs = require('fs');
const url = require('url');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fsPromise = require('fs/promises');

const secretKey = 'mySecretKey';

/**
 * @type {{
 *  users: Array< {id: Number} >,
 *  files: Array< {id: Number, path: String} >
 * }}
 */
const data = { users: [], files: [] };

async function initFileList() {
    try {
        const files = await fsPromise.readdir(path.join(__dirname, 'files'));
        files.forEach((fileName) => {
            const [fileId] = /\d+/.exec(fileName);
            data.files.push({ id: parseInt(fileId), path: path.join(__dirname, 'files', fileName) });
        });
    } catch (error) {
        console.log(error.message);
        throw new Error(`Initialization error: ${error.message}`);
    }
}

const METHODS = {
    GET: 'get',
    PUT: 'put',
    POST: 'post',
    DELETE: 'delete',
};

function generateJWT(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const content = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = crypto.createHmac('sha256', secretKey).update(`${header}.${content}`).digest('base64');
    return `${header}.${content}.${signature}`;
}

function verifyJWT(token) {
    const [header, content, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', secretKey).update(`${header}.${content}`).digest('base64');
    return signature === expectedSignature;
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const urlPath = parsedUrl.pathname;
    const method = req.method.toLowerCase();

    if (method === 'post' && urlPath === '/login') {
        return handleLogin(req, res);
    } else {
        // const authorization = req.headers.authorization;
        // if (!authorization) {
        //     return sendResponse(res, 401, {
        //         message: 'No authorization info',
        //     });
        // }
        // const [, token] = authorization.split(' ');
        // if (!verifyJWT(token)) {
        //     return sendResponse(res, 401, {
        //         message: 'Invalid token',
        //     });
        // }

        if (urlPath === '/data') {
            switch (method) {
                case METHODS.GET:
                    return handleGetData(res);
                case METHODS.POST:
                    return handleCreateData(req, res);
                case METHODS.PUT:
                    return handleUpdateData(req, res);
                case METHODS.DELETE:
                    return handleDeleteData(parsedUrl.query, res);
                default:
                    return sendResponse(res, 405, {
                        message: `Method '${method}' is not allowed`,
                    });
            }
        } else if (urlPath === '/file') {
            switch (method) {
                case METHODS.POST:
                    return handleFileUpload(req, res);
                default:
                    return sendResponse(res, 405, {
                        message: `Method '${method}' is not allowed`,
                    });
            }
        } else if (/^\/file\/\d+$/.test(urlPath)) {
            switch (method) {
                case METHODS.GET:
                    return handleFileDownload(urlPath, res);
                default:
                    return sendResponse(res, 405, {
                        message: `Method '${method}' is not allowed`,
                    });
            }
        } else {
            return handlePageNotFound(res);
        }
    }
});

function handleLogin(req, res) {
    let body = '';

    req.on('data', (chunk) => {
        body += chunk.toString();
    });

    req.on('end', () => {
        const { username, password } = JSON.parse(body);

        if (username === 'admin' && password === 'admin') {
            const token = generateJWT({ username });
            return sendResponse(res, 200, { token });
        } else {
            return sendResponse(res, 401, {
                message: 'Invalid credentials',
            });
        }
    });
}

function handleGetData(res) {
    return sendResponse(res, 200, data.users);
}

function handleCreateData(req, res) {
    let body = '';

    req.on('data', (chunk) => {
        body += chunk.toString();
    });

    req.on('end', () => {
        const newData = JSON.parse(body);
        newData.id = Date.now();
        data.users.push(newData);
        return sendResponse(res, 201, newData);
    });
}

function handleUpdateData(req, res) {
    let body = '';

    req.on('data', (chunk) => {
        body += chunk.toString();
    });

    req.on('end', () => {
        const updatedData = JSON.parse(body);
        const dataIndex = data.users.findIndex((item) => item.id === updatedData.id);

        if (dataIndex !== -1) {
            data.users[dataIndex] = updatedData;
            return sendResponse(res, 200, updatedData);
        } else {
            return sendResponse(res, 404, {
                message: 'Data not found',
            });
        }
    });
}

function handleDeleteData(query, res) {
    const { id } = query;
    if (!id) {
        return sendResponse(res, 400, {
            message: 'Data id is not provided',
        });
    }

    const dataIndex = data.users.findIndex((item) => item.id == id);

    if (dataIndex !== -1) {
        data.users.splice(dataIndex, 1);
        return sendResponse(res, 200, {
            message: 'OK',
        });
    } else {
        return sendResponse(res, 404, {
            message: 'Data not found',
        });
    }
}

function handlePageNotFound(res) {
    return sendResponse(res, 404, {
        message: 'Route not found',
    });
}

function handleFileDownload(urlPath, res) {
    const [, fileId] = /^\/file\/(\d+)$/.exec(urlPath) || [];
    if (!fileId) {
        return sendResponse(res, 404, { message: `File id is not provided` });
    }

    const file = data.files.find((f) => f.id == fileId);
    if (!file) {
        return sendResponse(res, 404, { message: `There is no file with '${fileId}' id` });
    }

    const readStream = fs.createReadStream(file.path);
    readStream.on('error', (error) => {
        return sendResponse(res, 400, {
            message: error,
        });
    });
    // res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    readStream.pipe(res);
}

function handleFileUpload(req, res) {
    const boundary = req.headers['content-type'].split('; ')[1].split('=')[1];
    let fileBuffer = Buffer.from([]);

    req.on('data', (chunk) => {
        fileBuffer = Buffer.concat([fileBuffer, chunk]);
    });

    req.on('end', () => {
        const fileStart = fileBuffer.indexOf(`--${boundary}\r\n`) + boundary.length + 4;
        const fileEnd = fileBuffer.indexOf(`\r\n--${boundary}--\r\n`);

        if (fileStart !== -1 && fileEnd !== -1) {
            const fileContent = fileBuffer.slice(fileStart, fileEnd);

            const filenameMatch = /filename="([^"]+)"/.exec(fileContent.toString());
            const extension = filenameMatch ? '.' + filenameMatch[1].split('.').pop() : '';

            const fileId = Date.now();
            const filePath = path.join(__dirname, 'files', `${fileId}${extension}`);

            fs.writeFile(filePath, fileContent, 'binary', (error) => {
                if (error) {
                    return sendResponse(res, 500, { message: 'Error while saving the file' });
                } else {
                    data.files.push({ id: fileId, path: filePath });
                    return sendResponse(res, 200, { message: `File uploaded successfully. New file id is '${fileId}'` });
                }
            });
        } else {
            return sendResponse(res, 400, { message: 'Invalid file content' });
        }
    });
}

function sendResponse(res, statusCode, body) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

const port = 3000;

(async () => {
    await initFileList();

    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
})();
