# Playbook: Liquidity Sweep (Stop Hunt)

## מהו Liquidity Sweep
מוסדיים מריצים את המחיר מעל/מתחת לרמה שהקהל שם שם SL,
אוספים את הלקווידיטי שנוצרת, ואז מסתובבים בכיוון ההפוך.

## הסימנים
1. **Equal Highs/Lows** — רמות ברורות שכולם רואים = Liquidity Pool
2. **Wick ארוך** שפורץ מעל/מתחת לרמה ואז נסגר בחזרה
3. **נפח גבוה** בנקודת הפריצה — מוסדיים פועלים
4. **Market Structure Shift** — שינוי מבנה בTimeframe נמוך אחרי ה-Sweep

## תהליך זיהוי

```
Daily/4H: זיהוי Equal Highs / Lows (Liquidity)
    ↓
1H: ציפייה לפריצה + חזרה
    ↓
15m: אישור MSS + כניסה בכיוון ההפוך
```

## כניסה (Short אחרי Sweep מעלה)
- Sweep עבר מעל Equal Highs
- נר Bearish Engulfing / Pin Bar ב-1H
- MSS ב-15m (Lower Low)
- כניסה ב-15m בretest של ה-MSS

## כניסה (Long אחרי Sweep מטה)
- Sweep עבר מתחת ל-Equal Lows
- נר Bullish Engulfing / Pin Bar ב-1H
- MSS ב-15m (Higher High)
- כניסה ב-15m בretest

## Stop Loss
מעל/מתחת לנקודת ה-Sweep (לא ה-Equal High/Low המקורית)

## Take Profit
- TP1: גובה ה-Range / Draw on Liquidity הבא
- TP2: אזור FVG הקרוב בכיוון

## זהירות
- לא כל פריצה היא Sweep — לבדוק נפח + ריאקשן
- לא להיכנס בזמן ה-Sweep עצמו — לחכות לאישור
