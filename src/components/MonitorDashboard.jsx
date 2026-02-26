import React, { useState, useEffect, useRef, useCallback } from 'react';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import OriginalLayout from './OriginalLayout';
import VerticalLayout from './VerticalLayout';
import { megaTraderAPI } from '../utils/megaTraderAPI';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Helper to play tiered alert sounds
const playAlertSound = (qty) => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = audioCtx.createGain();
        gainNode.connect(audioCtx.destination);

        const now = audioCtx.currentTime;
        const volume = 0.2;

        // Tier 4: > 200,000 - "Siren" (1.0s)
        if (qty >= 200000) {
            const osc = audioCtx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(1000, now);
            osc.frequency.linearRampToValueAtTime(1500, now + 0.2);
            osc.frequency.linearRampToValueAtTime(1000, now + 0.4);
            osc.frequency.linearRampToValueAtTime(1500, now + 0.6);
            osc.frequency.linearRampToValueAtTime(1000, now + 0.8);

            gainNode.gain.setValueAtTime(volume, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 1.0);

            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 1.0);
        }
        // Tier 3: > 100,000 - "Charge" (0.8s)
        else if (qty >= 100000) {
            const osc = audioCtx.createOscillator();
            osc.type = 'square';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.6);

            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(volume, now + 0.1);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.8);

            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 0.8);
        }
        // Tier 2: > 50,000 - "Coin" (0.6s total)
        else if (qty >= 50000) {
            // Note 1
            const osc1 = audioCtx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1046.50, now); // C6

            const gain1 = audioCtx.createGain();
            gain1.connect(audioCtx.destination);
            gain1.gain.setValueAtTime(volume, now);
            gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

            osc1.connect(gain1);
            osc1.start(now);
            osc1.stop(now + 0.2);

            // Note 2
            const osc2 = audioCtx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1318.51, now + 0.15); // E6

            const gain2 = audioCtx.createGain();
            gain2.connect(audioCtx.destination);
            gain2.gain.setValueAtTime(volume, now + 0.15);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

            osc2.connect(gain2);
            osc2.start(now + 0.15);
            osc2.stop(now + 0.5);
        }
        // Tier 1: > 20,000 - "Pop" (0.5s)
        else {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.4);

            gainNode.gain.setValueAtTime(volume, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 0.4);
        }
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
    onLayoutChange,

    depthEvents, // Low-latency event bus
    isSidebarVisible, // New prop
    onToggleSidebar // New prop
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
    const [autoOrderThreshold, setAutoOrderThreshold] = useState(() => {
        const saved = localStorage.getItem(`mt_auto_order_threshold_${id}`);
        return saved ? JSON.parse(saved) : 90000;
    });
    const [isAutomationEnabled, setIsAutomationEnabled] = useState(() => {
        const saved = localStorage.getItem(`mt_is_automation_enabled_${id}`);
        return saved ? JSON.parse(saved) : false;
    });
    const [autoOrderExecutionQty, setAutoOrderExecutionQty] = useState(() => {
        const saved = localStorage.getItem(`mt_auto_order_exec_qty_${id}`);
        return saved ? JSON.parse(saved) : 50; // Default to a common lot size
    });
    const [targetTotalQty, setTargetTotalQty] = useState(() => {
        const saved = localStorage.getItem(`mt_target_total_qty_${id}`);
        return saved ? JSON.parse(saved) : 100000;
    });
    const [timerSeconds, setTimerSeconds] = useState(() => {
        const saved = localStorage.getItem(`mt_timer_seconds_${id}`);
        return saved ? JSON.parse(saved) : 60;
    });
    const [triggerPriceValue, setTriggerPriceValue] = useState(() => {
        const saved = localStorage.getItem(`mt_trigger_price_${id}`);
        return saved ? JSON.parse(saved) : 0;
    });

    // --- Core Automation Refs ---
    const activeAccumulations = useRef({}); // Track timers per tokenId_side: { startTime, accumulatedQty, timerId }

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

    useEffect(() => {
        localStorage.setItem(`mt_auto_order_threshold_${id}`, JSON.stringify(autoOrderThreshold));
    }, [autoOrderThreshold, id]);

    useEffect(() => {
        localStorage.setItem(`mt_is_automation_enabled_${id}`, JSON.stringify(isAutomationEnabled));
    }, [isAutomationEnabled, id]);

    useEffect(() => {
        localStorage.setItem(`mt_auto_order_exec_qty_${id}`, JSON.stringify(autoOrderExecutionQty));
    }, [autoOrderExecutionQty, id]);

    useEffect(() => {
        localStorage.setItem(`mt_target_total_qty_${id}`, JSON.stringify(targetTotalQty));
    }, [targetTotalQty, id]);

    useEffect(() => {
        localStorage.setItem(`mt_timer_seconds_${id}`, JSON.stringify(timerSeconds));
    }, [timerSeconds, id]);

    useEffect(() => {
        localStorage.setItem(`mt_trigger_price_${id}`, JSON.stringify(triggerPriceValue));
    }, [triggerPriceValue, id]);

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



    // --- Direct Audio Link (Low Latency) ---
    useEffect(() => {
        if (!depthEvents) return;

        const handlePacket = (e) => {
            const packet = e.detail;
            const tkn = packet.Tkn || packet.Token;

            // 1. Find if we are monitoring this token
            const monitoredItem = monitoredTokens.find(m => String(m.tkn) === String(tkn));
            if (!monitoredItem) return;

            // 2. Check Thresholds
            const depths = packet.depths || [];

            // Check both sides if needed
            const sidesToCheck = monitoredItem.side === 'both' ? ['buy', 'sell'] : [monitoredItem.side];

            for (const side of sidesToCheck) {
                const internalSide = side === 'buy' ? 'bid' : 'ask';

                // Find any depth in this packet that crosses threshold
                const hasHighQty = depths.some(d => {
                    const qty = internalSide === 'bid' ? d.BQ : d.SQ;
                    return qty >= monitoredItem.quantity;
                });

                if (hasHighQty) {
                    // 3. Play Sound Immediately (Bypassing React State)
                    // We use the highest qty in the packet to determine pitch/tier, 
                    // or just trigger the sound for the first match.
                    // Let's find the max qty to play the correct tier.
                    const maxQty = Math.max(...depths.map(d => internalSide === 'bid' ? d.BQ : d.SQ));
                    if (maxQty >= monitoredItem.quantity) {
                        playAlertSound(maxQty);
                    }
                }
            }
        };

        depthEvents.addEventListener('depth-packet', handlePacket);
        return () => depthEvents.removeEventListener('depth-packet', handlePacket);
    }, [depthEvents, monitoredTokens]); // Re-bind when monitored list changes

    // --- Polling & Alert Logic (Visuals Only) ---
    const latestDepthData = useRef(depthData);
    useEffect(() => {
        latestDepthData.current = depthData;
    }, [depthData]);

    const priceLevels = useRef({});
    const lastProcessedTimes = useRef({}); // Track last processed packet timestamp per token

    useEffect(() => {
        if (monitoredTokens.length === 0) return;

        const pollInterval = setInterval(() => {
            if (status !== 'Connected' && status !== 'CONNECTED' && status !== 'connected') return;

            const currentData = latestDepthData.current;

            monitoredTokens.forEach(item => {
                const tkn = item.tkn;
                const depth = currentData[tkn] || currentData[Number(tkn)];
                if (!depth) return;

                // Check for Freshness
                const lastTime = lastProcessedTimes.current[tkn] || 0;
                const pktTime = depth._receivedAt || 0;
                const isFresh = pktTime > lastTime;

                if (!isFresh) return;

                lastProcessedTimes.current[tkn] = pktTime;

                const sides = item.side === 'both' ? ['buy', 'sell'] : [item.side];

                sides.forEach(side => {
                    const internalSide = side === 'buy' ? 'bid' : 'ask';
                    const depths = depth.depths || [];
                    const qualifyingDepths = depths.filter(d => {
                        const qty = internalSide === 'bid' ? d.BQ : d.SQ;
                        return qty > 0; // Capture all valid quantities
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

                        // 1. Independent Automation Trigger & Accumulation
                        const autoLevelKey = `${item.id}_${side}_auto`; // Broadened key to side-level (not specific price) for total accumulation
                        const autoState = priceLevels.current[autoLevelKey] || { lastOrderTime: 0 };
                        const autoTimeDiff = now - autoState.lastOrderTime;

                        if (isAutomationEnabled && autoTimeDiff > 5000) { // 5s universal cooldown per side
                            const accumKey = `${item.id}_${side}`;
                            let currentAccum = activeAccumulations.current[accumKey];

                            // Bypass timer if logic says 0
                            const bypassTimer = !timerSeconds || timerSeconds <= 0 || !targetTotalQty || targetTotalQty <= 0;

                            if (bypassTimer) {
                                // Instant Execution (Legacy Behavior)
                                if (observedQty >= autoOrderThreshold) {
                                    console.log(`[MegaTrader] Auto-triggering order (Instant) for ${observedQty} @ ${price} (Signal Threshold: ${autoOrderThreshold}, Order Qty: ${autoOrderExecutionQty}, SL/Trigger: ${triggerPriceValue})`);
                                    const details = {
                                        index: item.index, strike: item.strike, type: item.type,
                                        side, observedQty, price, time: new Date().toLocaleTimeString(),
                                        timestamp: now, tokenId: item.id, tkn: item.tkn,
                                        executionQty: autoOrderExecutionQty,
                                        triggerPrice: triggerPriceValue > 0 ? Number((side === 'buy' ? priceVal - triggerPriceValue : priceVal + triggerPriceValue).toFixed(2)) : 0
                                    };
                                    megaTraderAPI.triggerOrder(details);
                                    autoState.lastOrderTime = now;
                                    priceLevels.current[autoLevelKey] = autoState;
                                }
                            } else {
                                // Timer Sequence Logic
                                if (!currentAccum && observedQty >= autoOrderThreshold) {
                                    // Step A: Initial Trigger -> Start Timer
                                    console.log(`[MegaTrader] Accumulation Timer Started for ${accumKey}. Signal: ${observedQty}. Target: ${targetTotalQty} in ${timerSeconds}s.`);

                                    const timerId = setTimeout(() => {
                                        // Step C: Expiration (Goal Missed)
                                        console.log(`[MegaTrader] Timer Expired for ${accumKey}. Total Accumulated: ${activeAccumulations.current[accumKey]?.accumulatedQty}. Goal: ${targetTotalQty} Missed.`);
                                        delete activeAccumulations.current[accumKey];
                                    }, timerSeconds * 1000);

                                    currentAccum = {
                                        startTime: now,
                                        accumulatedQty: observedQty, // Bank the first one
                                        timerId: timerId
                                    };
                                    activeAccumulations.current[accumKey] = currentAccum;
                                } else if (currentAccum) {
                                    // Step B: Accumulating only meaningful quantities (>= user threshold)
                                    // SEARCH TAG: task_allticks - Remove the "if (observedQty >= autoOrderThreshold)" wrapper below to include all micro-ticks
                                    if (observedQty >= autoOrderThreshold) {
                                        currentAccum.accumulatedQty += observedQty;
                                        console.log(`[MegaTrader] Accumulating... Added: ${observedQty}. New Total: ${currentAccum.accumulatedQty}/${targetTotalQty}`);
                                    }
                                }
                                if (currentAccum && currentAccum.accumulatedQty >= targetTotalQty) {
                                    console.log(`[MegaTrader] Accumulation Goal Met for ${accumKey}! Total: ${currentAccum.accumulatedQty}. Targeting Execution Qty: ${autoOrderExecutionQty} with TriggerPrice: ${triggerPriceValue}`);

                                    clearTimeout(currentAccum.timerId); // Stop the timer
                                    delete activeAccumulations.current[accumKey]; // Reset for next signal

                                    const details = {
                                        index: item.index, strike: item.strike, type: item.type,
                                        side, observedQty, price, time: new Date().toLocaleTimeString(),
                                        timestamp: now, tokenId: item.id, tkn: item.tkn,
                                        executionQty: autoOrderExecutionQty,
                                        triggerPrice: triggerPriceValue > 0 ? Number((side === 'buy' ? priceVal - triggerPriceValue : priceVal + triggerPriceValue).toFixed(2)) : 0
                                    };
                                    megaTraderAPI.triggerOrder(details);
                                    autoState.lastOrderTime = now;
                                    priceLevels.current[autoLevelKey] = autoState;
                                }
                            }
                        }

                        // 2. Visual Log Filter (Only evaluate if it meets the column threshold)
                        let shouldLog = false;

                        // Only Log if the quantity is >= the user's set threshold
                        if (isQtyHigher && observedQty >= item.quantity) {
                            shouldLog = true;
                            state.maxQty = observedQty;
                        } else if (observedQty >= item.quantity) {
                            // Also log change if it meets threshold
                            const qtyChange = Math.abs(observedQty - state.lastAlertQty) / state.lastAlertQty;
                            if (timeDiff > 2000 || (qtyChange > 0.05 && timeDiff > 500)) {
                                shouldLog = true;
                            }
                        }

                        if (shouldLog) {
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
                                tokenId: item.id, // useful for filtering
                                tkn: item.tkn     // API token for MegaTrader
                            };
                            const logId = `${item.id}-${side}-${observedQty}-${now}-${Math.random().toString(36).substr(2, 9)}`;

                            setLogs(prev => [{ ...details, id: logId }, ...prev].slice(0, 3000)); // Increased buffer to 3000

                            // Global Notification (still throttled by log logic)
                            addGlobalNotification({ ...details, id: logId });
                        }
                    });
                });
            });
        }, 100);

        return () => {
            clearInterval(pollInterval);
            // Cleanup any active accumulation timeouts
            Object.values(activeAccumulations.current).forEach(accum => clearTimeout(accum.timerId));
        };
    }, [monitoredTokens, showAllPrices, addGlobalNotification, status, autoOrderThreshold, isAutomationEnabled, autoOrderExecutionQty, targetTotalQty, timerSeconds, triggerPriceValue]);

    // --- Log Retention & Cleanup ---
    useEffect(() => {
        const cleanupInterval = setInterval(() => {
            setLogs(prevLogs => {
                const now = Date.now();
                const logsByGroup = {}; // Key: tokenId_side
                const keptLogs = [];

                // 1. Group logs by Token ID AND Side
                prevLogs.forEach(log => {
                    const key = `${log.tokenId}_${log.side}`;
                    if (!logsByGroup[key]) logsByGroup[key] = [];
                    logsByGroup[key].push(log);
                });

                // 2. Apply Retention Policy per Group (Token + Side)
                Object.values(logsByGroup).forEach(groupLogs => {
                    // Start is newest (index 0)
                    // Keep first 45 unconditionally (Safety Floor per side)
                    const safeCount = 45;
                    const safeLogs = groupLogs.slice(0, safeCount);

                    // Candidates for expiry (beyond 45)
                    const candidatesForExpiry = groupLogs.slice(safeCount);

                    // Filter candidates: Keep only if younger than 60s
                    const retainedCandidates = candidatesForExpiry.filter(l => (now - l.timestamp) < 60000);

                    keptLogs.push(...safeLogs, ...retainedCandidates);
                });

                // 3. Re-sort and Return (descending timestamp)
                return keptLogs.sort((a, b) => b.timestamp - a.timestamp);
            });
        }, 5000); // Run cleanup every 5 seconds

        return () => clearInterval(cleanupInterval);
    }, []);


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
        setLogs(prev => prev.filter(l => l.tokenId !== tokenId)); // Clean up logs for removed token
    };

    const handleClearLogs = useCallback((tokenId, side) => {
        setLogs(prev => prev.filter(log => !(log.tokenId === tokenId && log.side === side)));
    }, []);

    const handleClearAllTokens = () => {
        setMonitoredTokens([]);
        setLogs([]);
    };


    const handleUpdateTokenQty = (tokenId, newQty) => {
        setMonitoredTokens(prev => prev.map(m =>
            m.id === tokenId ? { ...m, quantity: parseInt(newQty) || 0 } : m
        ));
    };

    const handleUpdateTokenStrike = (tokenId, newStrike, newTkn, newSymbol) => {
        setLogs(prev => prev.filter(l => l.tokenId !== tokenId)); // Clear logs for this token
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
        setLogs(prev => prev.filter(l => l.tokenId !== tokenId)); // Clear logs for this token
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

    const handleUpdateTokenWidth = (tokenId, newWidth) => {
        setMonitoredTokens(prev => prev.map(m =>
            m.id === tokenId ? { ...m, width: newWidth } : m
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
                    onClearTokens={handleClearAllTokens}
                    onUpdateTokenQty={handleUpdateTokenQty}
                    onUpdateTokenStrike={handleUpdateTokenStrike}
                    onUpdateTokenType={handleUpdateTokenType}
                    // Pass down logic state for the config bar toggle
                    showAllPrices={showAllPrices}
                    setShowAllPrices={setShowAllPrices}
                    isSidebarVisible={isSidebarVisible}
                    onToggleSidebar={onToggleSidebar}
                />
            ) : (
                <VerticalLayout
                    visibleElements={visibleElements}
                    monitoredTokens={monitoredTokens}
                    logs={logs}
                    onAddTokens={handleAddTokens}
                    onRemoveToken={handleRemoveToken}
                    onClearTokens={handleClearAllTokens}
                    onUpdateTokenQty={handleUpdateTokenQty}
                    onUpdateTokenStrike={handleUpdateTokenStrike}
                    onUpdateTokenType={handleUpdateTokenType}
                    onUpdateTokenWidth={handleUpdateTokenWidth}
                    onClearLogs={handleClearLogs}
                    showAllPrices={showAllPrices}
                    setShowAllPrices={setShowAllPrices}
                    onReorderTokens={setMonitoredTokens} // Pass drag-and-drop handler
                    isSidebarVisible={isSidebarVisible}
                    depthData={depthData}
                    autoOrderThreshold={autoOrderThreshold}
                    onUpdateThreshold={setAutoOrderThreshold}
                    isAutomationEnabled={isAutomationEnabled}
                    onToggleAutomation={setIsAutomationEnabled}
                    autoOrderExecutionQty={autoOrderExecutionQty}
                    onUpdateExecutionQty={setAutoOrderExecutionQty}
                    targetTotalQty={targetTotalQty}
                    onUpdateTargetTotalQty={setTargetTotalQty}
                    timerSeconds={timerSeconds}
                    onUpdateTimerSeconds={setTimerSeconds}
                    triggerPriceValue={triggerPriceValue}
                    onUpdateTriggerPrice={setTriggerPriceValue}
                />
            )}
        </div>
    );
};

export default MonitorDashboard;
