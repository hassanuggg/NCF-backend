const http = require('http');

function sendJson(method, path, body){
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body || {});
        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }); }
                catch (e) { resolve({ status: res.statusCode, body: chunks }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function run(){
    // tiny 1x1 PNG
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQImWNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

    console.log('Creating news (with image)...');
    const create = await sendJson('POST','/news',{ title: 'Test from script', description: 'Automated test', imageData: tinyPng });
    console.log('Create response:', create.status, create.body);
    if (!create.body || !create.body.id) return console.error('Create failed');
    const id = create.body.id;

    console.log('Updating news (change title)...');
    const update = await sendJson('PUT', `/news/${id}`, { title: 'Updated by script', description: 'Updated description' });
    console.log('Update response:', update.status, update.body);

    console.log('Deleting news...');
    const del = await sendJson('DELETE', `/news/${id}` , {});
    console.log('Delete response:', del.status, del.body);

    console.log('Test sequence done.');
}

run().catch(err => { console.error('Test script error', err); process.exit(1); });
