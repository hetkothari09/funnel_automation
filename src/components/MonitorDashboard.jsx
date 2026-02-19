import React, { useState, useEffect, useRef, useCallback } from 'react';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import OriginalLayout from './OriginalLayout';
import VerticalLayout from './VerticalLayout';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Helper to play a short "ting" sound
const playAlertSound = () => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
        oscillator.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1); // Quick slide up

        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
        console.warn('Audio alert failed', e);
    }
};

const MonitorDashboard = ({
    id,
    isActive,
    depthData,
    status,
    subscribe,
    addGlobalNotification,
    visibleElements,
    onRemove,
    layoutMode,
    onLayoutChange
}) => {
    // --- Layout State is now controlled by Parent (App.jsx) ---


    // --- Data State ---
    const [monitoredTokens, setMonitoredTokens] = useState(() => {
        const saved = localStorage.getItem(`mt_monitored_tokens_${id}`);
        return saved ? JSON.parse(saved) : [];
    });
    const [logs, setLogs] = useState(() => {
        const saved = localStorage.getItem(`mt_logs_${id}`);
        return saved ? JSON.parse(saved) : [];
    });

    // --- Logic Configuration State ---
    const [showAllPrices, setShowAllPrices] = useState(() => {
        const saved = localStorage.getItem(`mt_show_all_prices_${id}`);
        return saved ? JSON.parse(saved) : false;
    });

    // --- Persistence ---
    useEffect(() => {
        localStorage.setItem(`mt_monitored_tokens_${id}`, JSON.stringify(monitoredTokens));
    }, [monitoredTokens, id]);

    useEffect(() => {
        localStorage.setItem(`mt_logs_${id}`, JSON.stringify(logs));
    }, [logs, id]);

    useEffect(() => {
        localStorage.setItem(`mt_show_all_prices_${id}`, JSON.stringify(showAllPrices));
    }, [showAllPrices, id]);

    // --- Subscription Management ---
    // Resubscribe on mount/reload if tokens exist
    useEffect(() => {
        if (monitoredTokens.length > 0) {
            const tokensToSub = monitoredTokens.map(item => ({
                Xchg: item.index === 'SENSEX' ? 'BSEFO' : 'NSEFO',
                Tkn: item.tkn,
                Symbol: item.symbol
            }));
            subscribe(tokensToSub);
        }
    }, [subscribe, monitoredTokens.length]); // Length check is proxy for list existence/reset

    // --- Polling & Alert Logic ---
    const latestDepthData = useRef(depthData);
    useEffect(() => {
        latestDepthData.current = depthData;
    }, [depthData]);

    const priceLevels = useRef({});

    useEffect(() => {
        if (monitoredTokens.length === 0) return;

        const pollInterval = setInterval(() => {
            const currentData = latestDepthData.current;

            monitoredTokens.forEach(item => {
                const tkn = item.tkn;
                const depth = currentData[tkn] || currentData[Number(tkn)];
                if (!depth) return;

                const sides = item.side === 'both' ? ['buy', 'sell'] : [item.side];

                sides.forEach(side => {
                    const internalSide = side === 'buy' ? 'bid' : 'ask';
                    const depths = depth.depths || [];
                    const qualifyingDepths = depths.filter(d => {
                        const qty = internalSide === 'bid' ? d.BQ : d.SQ;
                        return qty >= item.quantity;
                    });

                    qualifyingDepths.forEach(matchingDepth => {
                        const internalSide = side === 'buy' ? 'bid' : 'ask';
                        const observedQty = internalSide === 'bid' ? matchingDepth.BQ : matchingDepth.SQ;
                        const price = internalSide === 'bid' ? matchingDepth.BP : matchingDepth.SP;
                        const priceVal = parseFloat(price);

                        if (!showAllPrices) {
                            const isWholeNumber = priceVal % 1 === 0;
                            if (isWholeNumber && priceVal % 5 === 0) return;
                        }

                        const priceKey = priceVal.toFixed(5);
                        const levelKey = `${item.id}_${side}_${priceKey}`;

                        const state = priceLevels.current[levelKey] || { maxQty: 0, lastAlertQty: 0, lastAlertTime: 0 };

                        const now = Date.now();
                        const timeDiff = now - state.lastAlertTime;
                        const isQtyHigher = observedQty > state.maxQty;

                        let shouldAlert = false;

                        if (isQtyHigher) {
                            shouldAlert = true;
                            state.maxQty = observedQty;
                        } else {
                            const qtyChange = Math.abs(observedQty - state.lastAlertQty) / state.lastAlertQty;
                            if (timeDiff > 2000 || (qtyChange > 0.05 && timeDiff > 500)) {
                                shouldAlert = true;
                            }
                        }

                        if (shouldAlert) {
                            state.lastAlertQty = observedQty;
                            state.lastAlertTime = now;
                            priceLevels.current[levelKey] = state;

                            const details = {
                                index: item.index,
                                strike: item.strike,
                                type: item.type,
                                side,
                                observedQty,
                                price,
                                time: new Date().toLocaleTimeString(),
                                timestamp: now,
                                tokenId: item.id // useful for filtering
                            };
                            const logId = `${item.id}-${side}-${observedQty}-${now}`;

                            setLogs(prev => [{ ...details, id: logId }, ...prev].slice(0, 500)); // Increased limit slightly
                            addGlobalNotification({ ...details, id: logId });
                            playAlertSound();
                        }
                    });
                });
            });
        }, 100);

        return () => clearInterval(pollInterval);
    }, [monitoredTokens, showAllPrices, addGlobalNotification]);


    // --- Handlers ---

    const handleAddTokens = (newTokens) => {
        setMonitoredTokens(prev => [...prev, ...newTokens]);
        const tokensToSub = newTokens.map(t => ({
            Xchg: t.index === 'SENSEX' ? 'BSEFO' : 'NSEFO',
            Tkn: t.tkn,
            Symbol: t.symbol
        }));
        subscribe(tokensToSub);
    };

    const handleRemoveToken = (tokenId) => {
        setMonitoredTokens(prev => prev.filter(m => m.id !== tokenId));
    };

    const handleClearTokens = () => {
        setMonitoredTokens([]);
    };

    const handleUpdateTokenQty = (tokenId, newQty) => {
        setMonitoredTokens(prev => prev.map(m =>
            m.id === tokenId ? { ...m, quantity: parseInt(newQty) || 0 } : m
        ));
    };

    const handleUpdateTokenStrike = (tokenId, newStrike, newTkn, newSymbol) => {
        setMonitoredTokens(prev => prev.map(m => {
            if (m.id === tokenId) {
                const xchg = m.index === 'SENSEX' ? 'BSEFO' : 'NSEFO';
                subscribe([{ Xchg: xchg, Tkn: newTkn, Symbol: newSymbol }]);
                return { ...m, strike: newStrike, tkn: newTkn, symbol: newSymbol };
            }
            return m;
        }
        ));
    };

    const handleUpdateTokenType = (tokenId, newType, newTkn, newSymbol) => {
        setMonitoredTokens(prev => prev.map(m => {
            if (m.id === tokenId) {
                const xchg = m.index === 'SENSEX' ? 'BSEFO' : 'NSEFO';
                subscribe([{ Xchg: xchg, Tkn: newTkn, Symbol: newSymbol }]);
                return { ...m, type: newType, tkn: newTkn, symbol: newSymbol };
            }
            return m;
        }
        ));
    };


    return (
        <div className={cn("flex flex-col h-full overflow-hidden relative", isActive ? "flex" : "hidden")}>


            {layoutMode === 'original' ? (
                <OriginalLayout
                    visibleElements={visibleElements}
                    monitoredTokens={monitoredTokens}
                    depthData={depthData}
                    logs={logs}
                    onAddTokens={handleAddTokens}
                    onRemoveToken={handleRemoveToken}
                    onClearTokens={handleClearTokens}
                    onUpdateTokenQty={handleUpdateTokenQty}
                    onUpdateTokenStrike={handleUpdateTokenStrike}
                    onUpdateTokenType={handleUpdateTokenType}
                    // Pass down logic state for the config bar toggle
                    showAllPrices={showAllPrices}
                    setShowAllPrices={setShowAllPrices}
                />
            ) : (
                <VerticalLayout
                    visibleElements={visibleElements}
                    monitoredTokens={monitoredTokens}
                    depthData={depthData}
                    logs={logs}
                    onAddTokens={handleAddTokens}
                    onRemoveToken={handleRemoveToken}
                    onClearTokens={handleClearTokens}
                    onUpdateTokenQty={handleUpdateTokenQty}
                    onUpdateTokenStrike={handleUpdateTokenStrike}
                    onUpdateTokenType={handleUpdateTokenType}
                    showAllPrices={showAllPrices}
                    setShowAllPrices={setShowAllPrices}
                />
            )}
        </div>
    );
};

export default MonitorDashboard;
