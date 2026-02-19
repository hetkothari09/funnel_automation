import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, X, ChevronDown, Check, ArrowUp, ArrowDown } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';
import contractsData from '../contracts_nsefo.json';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}



const VerticalLayout = ({
    monitoredTokens,
    logs,
    onAddTokens,
    onRemoveToken,
    onUpdateTokenQty,
    onUpdateTokenStrike,
    onUpdateTokenType, // New prop
    onClearTokens,
    visibleElements // New prop
}) => {
    // --- Top Bar State ---
    const [globalIndex, setGlobalIndex] = useState('NIFTY');
    const [globalExpiry, setGlobalExpiry] = useState('');

    // Derived Expiries for Global Index
    const availableExpiries = useMemo(() => {
        let searchIndex = globalIndex === 'SENSEX' ? 'BSX' : globalIndex;
        // Get all expiries for this index
        const filtered = contractsData.filter(c => c.s === searchIndex);
        const expiries = [...new Set(filtered.map(c => c.e))].sort();
        return expiries;
    }, [globalIndex]);

    // Auto-select expiry
    useEffect(() => {
        if (availableExpiries.length > 0 && !availableExpiries.includes(globalExpiry)) {
            const today = new Date().toISOString().split('T')[0];
            setGlobalExpiry(availableExpiries.find(e => e >= today) || availableExpiries[0]);
        }
    }, [availableExpiries, globalExpiry]);


    const handleAddColumn = () => {
        // Add a default column for the selected Global Index/Expiry
        // We need a default strike (roughly ATM).
        // For now, just pick a strike from the list or hardcode a "start" strike.
        // Better: Find a strike near 25000 (Nifty) or whatever.
        // Let's just pick the first strike available for the expiry to start, user changes it.
        // Or hardcode defaults: Nifty 24000, BankNifty 50000.

        let defaultStrike = '24000';
        if (globalIndex === 'BANKNIFTY') defaultStrike = '50000';
        if (globalIndex === 'SENSEX') defaultStrike = '80000';

        // Check if strike exists in contracts
        let searchIndex = globalIndex === 'SENSEX' ? 'BSX' : globalIndex;
        // Try to find a valid token for CE '24000' (or default)
        // If not found, just don't add? Or add with empty?
        // Let's try to find *any* strike if default fails.

        const validContract = contractsData.find(c =>
            c.s === searchIndex &&
            c.e === globalExpiry &&
            c.p === 'CE'
        );

        if (validContract) {
            // If we found a contract, use its strike if our default is bad
            // Actually, let's just use the validContract we found to ensure it works.
            // But ideally we want a round number.
            // Let's just use validContract.st for safety.
            const strike = typeof validContract.st === 'string' ? validContract.st : validContract.st.toString();

            const tokenObj = {
                id: `${validContract.t}_${Date.now()}`,
                tkn: validContract.t,
                symbol: validContract.ns,
                strike: parseFloat(strike).toString(), // Remove decimals if any
                type: 'CE',
                side: 'both', // Monitors both sides by default? User requirement: "2 subcolumns... 1 buy 1 sell". So 'both'.
                quantity: 5000,
                expiry: globalExpiry,
                index: globalIndex
            };
            onAddTokens([tokenObj]);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#050505]">
            {/* --- Top Bar --- */}
            {visibleElements?.config && (
                <div className="flex items-center gap-4 p-2 border-b border-white/10 bg-[#0a0a0e]">
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-white/40 uppercase font-bold">Index</label>
                        <select
                            value={globalIndex}
                            onChange={(e) => setGlobalIndex(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                            <option className="bg-[#0a0a0e] text-white" value="NIFTY">NIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="BANKNIFTY">BANKNIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="FINNIFTY">FINNIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="SENSEX">SENSEX</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-white/40 uppercase font-bold">Expiry</label>
                        <select
                            value={globalExpiry}
                            onChange={(e) => setGlobalExpiry(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                            {availableExpiries.map(e => <option className="bg-[#0a0a0e] text-white" key={e} value={e}>{e.split('T')[0]}</option>)}
                        </select>
                    </div>

                    <button
                        onClick={handleAddColumn}
                        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                        <Plus size={14} /> Add Column
                    </button>
                    <button onClick={onClearTokens} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 font-bold py-1 px-3 rounded text-[10px] h-7 flex items-center gap-2">
                        <Trash2 size={10} /> Clear
                    </button>
                </div>
            )}

            {/* --- Main Content (Horizontal Scroll) --- */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-2">
                <div className="flex h-full gap-2 w-full">
                    {monitoredTokens.map(token => (
                        <VerticalColumn
                            key={token.id}
                            token={token}
                            logs={logs.filter(l => l.tokenId === token.id)}
                            onRemove={() => onRemoveToken(token.id)}
                            onUpdateQty={(q) => onUpdateTokenQty(token.id, q)}
                            onUpdateStrike={(s) => {
                                // Find new token
                                let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
                                const strikeVal = Number(s).toFixed(5);
                                const contract = contractsData.find(c =>
                                    c.s === searchIndex &&
                                    c.p === token.type &&
                                    c.e === token.expiry &&
                                    Number(c.st).toFixed(5) === strikeVal
                                );
                                if (contract) {
                                    onUpdateTokenStrike(token.id, s, contract.t, contract.ns);
                                }
                            }}
                            onUpdateType={(newType) => {
                                let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
                                const strikeVal = Number(token.strike).toFixed(5);
                                const contract = contractsData.find(c =>
                                    c.s === searchIndex &&
                                    c.p === newType &&
                                    c.e === token.expiry &&
                                    Number(c.st).toFixed(5) === strikeVal
                                );
                                if (contract) {
                                    onUpdateTokenType(token.id, newType, contract.t, contract.ns);
                                }
                            }}
                        />
                    ))}

                    {monitoredTokens.length === 0 && (
                        <div className="flex items-center justify-center w-64 h-full border border-dashed border-white/10 rounded text-white/20 text-sm">
                            Add a column to start
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Sub-component for individual column
const VerticalColumn = ({ token, logs, onRemove, onUpdateQty, onUpdateStrike, onUpdateType }) => {
    // Local state for dropdowns
    const [isEditingStrike, setIsEditingStrike] = useState(false);

    // Derived All Strikes
    const allStrikes = useMemo(() => {
        let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
        // Get all strikes for this index + expiry
        // standardizing to number for sort
        const filtered = contractsData.filter(c =>
            c.s === searchIndex &&
            c.e === token.expiry
        );
        const strikes = [...new Set(filtered.map(c => Number(c.st)))];
        return strikes.sort((a, b) => a - b);
    }, [token.index, token.expiry]);

    // Auto-scroll to current strike
    const dropdownRef = useRef(null);
    useEffect(() => {
        if (isEditingStrike && dropdownRef.current) {
            const activeBtn = dropdownRef.current.querySelector('[data-active="true"]');
            if (activeBtn) {
                activeBtn.scrollIntoView({ block: 'center' });
            }
        }
    }, [isEditingStrike]);

    return (
        <div className="flex-1 min-w-[200px] max-w-[280px] h-full flex flex-col bg-[#0f1115] border border-white/10 rounded-lg shadow-lg">
            {/* Column Header */}
            <div className="p-2 border-b border-white/10 space-y-2 bg-[#15171c]">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white/50">{token.index} {token.expiry.split('T')[0]}</span>
                    <button onClick={onRemove} className="text-white/20 hover:text-red-400 transition-colors">
                        <X size={12} />
                    </button>
                </div>

                {/* Controls Row */}
                {/* Controls Row - Adjusted Spacing */}
                <div className="flex items-center gap-1 h-7">
                    {/* Strike - Allow natural width, prevent shrinking */}
                    <div className="relative">
                        <button
                            onClick={() => setIsEditingStrike(!isEditingStrike)}
                            className={cn(
                                "bg-transparent border-none p-0 flex items-center gap-0.5 transition-colors",
                                token.type === 'CE' ? "text-cyan-400 hover:text-cyan-300" : "text-purple-400 hover:text-purple-300"
                            )}
                        >
                            <span className="text-xl font-black tracking-tight leading-none">{token.strike}</span>
                            <ChevronDown size={14} className="opacity-40 flex-shrink-0" />
                        </button>

                        {isEditingStrike && (
                            <div
                                ref={dropdownRef}
                                className="absolute top-full left-0 mt-1 bg-[#1a1c21] border border-white/10 rounded shadow-xl z-50 max-h-64 overflow-y-auto min-w-[120px]"
                            >
                                {allStrikes.map(s => (
                                    <button
                                        key={s}
                                        data-active={s.toString() === token.strike}
                                        onClick={() => {
                                            onUpdateStrike(s.toString());
                                            setIsEditingStrike(false);
                                        }}
                                        className={cn(
                                            "w-full text-left px-2 py-1.5 text-xs hover:bg-white/5 flex items-center justify-between",
                                            s.toString() === token.strike ? "text-yellow-400 font-bold bg-white/5" : "text-white/60"
                                        )}
                                    >
                                        {s}
                                        {s.toString() === token.strike && <Check size={10} />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Type Toggle */}
                    <button
                        onClick={() => onUpdateType(token.type === 'CE' ? 'PE' : 'CE')}
                        className={cn("px-1.5 py-0.5 rounded text-[11px] font-bold border transition-colors hover:brightness-110 flex-shrink-0 h-full flex items-center",
                            token.type === 'CE' ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-purple-500/10 text-purple-400 border-purple-500/20")}
                    >
                        {token.type}
                    </button>

                    {/* Qty Input */}
                    <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 flex-shrink-0 h-full">
                        <span className="text-[10px] text-white/30 uppercase font-bold">Q</span>
                        <input
                            type="number"
                            value={token.quantity}
                            onChange={(e) => onUpdateQty(e.target.value)}
                            className="bg-transparent border-none text-[11px] font-bold text-yellow-500 w-10 focus:outline-none text-right"
                        />
                    </div>
                </div>
            </div>

            {/* Split Columns (Buy | Sell) */}
            <div className="flex-1 min-h-0 flex divide-x divide-white/10">
                {/* Buy Column - Green Text Only */}
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="p-1 border-b border-white/5 text-center">
                        <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider opacity-80">Buy</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                        <AnimatePresence initial={false}>
                            {logs.filter(l => l.side === 'buy').map((log, i) => (
                                <motion.div
                                    key={log.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="flex items-center justify-between text-[11px] py-0.5 px-1 rounded hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                                >
                                    <span className="text-emerald-400 font-mono font-bold">{log.observedQty}</span>
                                    <span className="text-white/70 font-mono">{Number(log.price).toFixed(2)}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Sell Column - Red Text Only */}
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="p-1 border-b border-white/5 text-center">
                        <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider opacity-80">Sell</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                        <AnimatePresence initial={false}>
                            {logs.filter(l => l.side === 'sell').map((log, i) => (
                                <motion.div
                                    key={log.id}
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="flex items-center justify-between text-[11px] py-0.5 px-1 rounded hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                                >
                                    <span className="text-white/70 font-mono">{Number(log.price).toFixed(2)}</span>
                                    <span className="text-red-400 font-mono font-bold">{log.observedQty}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VerticalLayout;
