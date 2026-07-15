const http = require('http');

const loginData = JSON.stringify({ username: 'Ed Odongo Johnson', password: '2FCQ' });

const loginOptions = {
  host: '127.0.0.1',
  port: 3000,
  path: '/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData),
  },
};

const req = http.request(loginOptions, (res) => {
  let body = '';
  res.on('data', (d) => (body += d));
  res.on('end', () => {
    console.log('loginStatus', res.statusCode);
    try { console.log('loginBody', JSON.parse(body)); } catch (e) { console.log('loginBody', body); }

    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : (setCookie || '').split(';')[0];
    if (!cookie) {
      console.error('No session cookie received; cannot fetch protected pages.');
      return;
    }

    function fetchPage(path, label) {
      const r = http.request({ host: '127.0.0.1', port: 3000, path, method: 'GET', headers: { Cookie: cookie } }, (pageRes) => {
        let pb = '';
        pageRes.on('data', (d) => (pb += d));
        pageRes.on('end', () => {
          console.log(label, pageRes.statusCode, 'hasProfile=', pb.includes('profileMenuWrapper'));
        });
      });
      r.on('error', (e) => console.error(label + ' error', e));
      r.end();
    }

    fetchPage('/news-page', 'news-page');
    fetchPage('/messages-page', 'messages-page');
  });
});

req.on('error', (err) => { console.error('login request error', err); process.exit(1); });
req.write(loginData);
req.end();
