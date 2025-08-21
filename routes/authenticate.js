const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = () => {
    router.post('/auth/token', (req, res) => {
        const { apiKey, tenantId, userData } = req.body;

        if (!userData || !tenantId) {
            return res.status(400).json({ error: 'userData and tenantId required' });
        }

        const BROADCAST_API_KEY = process.env.BROADCAST_API_KEY;
        if (apiKey !== BROADCAST_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API Key' +  BROADCAST_API_KEY + ' vs ' + apiKey});
        }

        const JWT_SECRET = process.env.JWT_SECRET;

        const token = jwt.sign({
            tenantId,
            userData: userData || {},
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60) // 2 hours
        }, JWT_SECRET);

        res.json({
            token: token,
            tenantId: tenantId,
            userData: userData
        });
    });

    return router;

};
