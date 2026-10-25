const fs = require('fs');

const appendCode = `

exports.corsProxy = async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('No url provided');
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.referer;
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined
    });
    
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders['content-encoding'];
    
    res.set(responseHeaders);
    res.set('Access-Control-Allow-Origin', '*');
    
    response.body.pipe(res);
  } catch (err) {
    console.error('CORS proxy error:', err.message);
    res.status(500).send('Proxy error');
  }
};
`;

let f = fs.readFileSync('controllers/videoController.js', 'utf8');
f += appendCode;
fs.writeFileSync('controllers/videoController.js', f);
