class MegaTraderAPI {
    constructor() {
        // API Configuration - currently pointing to placeholder/local for testing
        // Update this URL with the actual MegaTrader endpoint when available
        this.baseUrl = ' http://192.168.6.164:16006';
        this.loginId = 'DILIP';
        this.password = 'a@4444444444';

        // Session state
        this.uniqueId = 0;
        this.refNo = '';
        this.isLoggedIn = false;

        // Rate Limiting / Deduplication
        // Prevents spamming orders for the exact same condition when qty hovers around 90k
        this.cooldowns = new Map();
        this.COOLDOWN_MS = 60 * 1000; // 1 minute per token + side
    }

    async login() {
        try {
            console.log(`[MegaTrader] Attempting login...`);
            const response = await fetch(`${this.baseUrl}/api/PublicAPI/LoginRequest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    LoginId: this.loginId,
                    Password: this.password
                })
            });

            const data = await response.json();

            // Expected Logic from PDF (Uniqueid or UniqueId handling case incase of casing differences)
            const uniqueId = data.UniqueId !== undefined ? data.UniqueId : data.Uniqueid;

            if (uniqueId && uniqueId !== 0 && !data.Error) {
                this.uniqueId = uniqueId;
                this.refNo = data.RefNo || '';
                this.isLoggedIn = true;
                console.log('[MegaTrader] Login Successful', data);
                return true;
            } else {
                console.error('[MegaTrader] Login Failed:', data.Error || data);
                return false;
            }
        } catch (error) {
            console.error('[MegaTrader] Connection or Request Error during Login:', error);
            return false;
        }
    }

    async placeOrder({ tokenNo, buySell, qty, price, triggerPrice = 0, gateway = 'NSEFO', exchange = 'NSEFO', clientCode = '' }) {
        if (!this.isLoggedIn) {
            const success = await this.login();
            if (!success) {
                console.error('[MegaTrader] Cannot place order, login sequence failed.');
                return;
            }
        }

        const payload = {
            Uniqueid: this.uniqueId,
            LoginId: this.loginId,
            RefNo: this.refNo,
            gateway: gateway,
            Exchange: exchange,
            Tokenno: String(tokenNo),
            clientcode: clientCode,
            Buysell: String(buySell).toUpperCase(), // EXPECTED: BUY or SELL
            qty: Number(qty),                       // DECIMAL
            qtydisclosed: 0,                        // DECIMAL (set to 0 to avoid lot validation errors on disclosed qty)
            Price: Number(price),                   // DECIMAL
            Triggerprice: Number(triggerPrice) || 0,                        // DECIMAL
            Booktype: Number(triggerPrice) > 0 ? 'SL' : 'RL',               // Stop Loss if Triggerprice exists
            validity: 'DAY',                        // Default to DAY
            DeliveryType: 1                         // 1 = Intraday, 0 = NORMAL
        };

        try {
            console.log('[MegaTrader] Placing Order with payload:', payload);
            const response = await fetch(`${this.baseUrl}/api/PublicAPI/OrderEntry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.Error) {
                console.error('[MegaTrader] Order Error:', data.Error);
            } else {
                console.log(`[MegaTrader] Order Initialized successfully. Internal Order No: ${data.IntOrdNo}`);
            }
            return data;
        } catch (error) {
            console.error('[MegaTrader] Order Entry Request Error:', error);
        }
    }

    triggerOrder(logDetails) {
        // Ensure logDetails contains required information
        const { side, observedQty, price, tokenId, tkn, executionQty, triggerPrice } = logDetails;
        if (!tkn) {
            console.warn('[MegaTrader] Missing explicit contract token (tkn). Cannot place order.');
            return;
        }

        const cooldownKey = `${tkn}_${side}`; // Distinguish between buy/sell side using token number 
        const now = Date.now();
        const lastTrigger = this.cooldowns.get(cooldownKey) || 0;

        if (now - lastTrigger < this.COOLDOWN_MS) {
            console.log(`[MegaTrader] Skipping order for ${cooldownKey} -> Cooldown active (${Math.round((this.COOLDOWN_MS - (now - lastTrigger)) / 1000)}s left)`);
            return;
        }

        // Apply Cooldown 
        this.cooldowns.set(cooldownKey, now);

        // Normalize Data for automation
        // Note: Side is "buy" or "sell". We map "buy" -> "BUY". Ensure client wants observed opposite or actual, defaulting to actual side observed.
        const orderAction = side.toUpperCase();

        // Define the concrete quantity to trade 
        const tradeQuantity = executionQty || 50;

        // Non-blocking trigger of asynchronous login & place order 
        this.placeOrder({
            tokenNo: tkn,
            buySell: orderAction,
            qty: tradeQuantity, // Passing the configured fixed execution quantity
            price: price,
            triggerPrice: triggerPrice,
            gateway: 'NSEFO',
            exchange: 'NSEFO',
            clientCode: ''
        });
    }
}

// Export singleton instance 
export const megaTraderAPI = new MegaTraderAPI();
