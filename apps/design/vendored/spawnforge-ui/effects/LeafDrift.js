import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
function Leaf({ style }) {
    return (_jsxs("svg", { viewBox: "0 0 24 24", width: "14", height: "14", fill: "rgba(134,239,172,0.55)", style: { position: 'absolute', ...style }, "aria-hidden": "true", children: [_jsx("path", { d: "M12 2C6.5 2 2 6.5 2 12c0 3.5 1.8 6.6 4.5 8.5C8 21.5 10 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.7 0-3.3-.5-4.6-1.4C5.6 17 4 14.6 4 12c0-4.4 3.6-8 8-8 4.4 0 8 3.6 8 8s-3.6 8-8 8z" }), _jsx("path", { d: "M12 4C8.1 4 4.8 7 4.1 11c.9-.6 2-1 3.1-1 3.3 0 6 2.7 6 6 0 1.1-.3 2.2-1 3.1C16 18.4 20 15 20 12c0-4.4-3.6-8-8-8z" })] }));
}
const LEAF_CONFIGS = [
    {
        startStyle: { left: '1%', top: '20%', animationDelay: '0s', animationDuration: '12s' },
        animName: 'sf-leaf-drift-1',
    },
    {
        startStyle: { left: '3%', top: '55%', animationDelay: '3s', animationDuration: '14s' },
        animName: 'sf-leaf-drift-2',
    },
    {
        startStyle: { right: '2%', top: '35%', animationDelay: '6s', animationDuration: '11s' },
        animName: 'sf-leaf-drift-3',
    },
    {
        startStyle: { right: '4%', top: '65%', animationDelay: '1.5s', animationDuration: '13s' },
        animName: 'sf-leaf-drift-4',
    },
    {
        startStyle: { left: '5%', top: '80%', animationDelay: '4s', animationDuration: '15s' },
        animName: 'sf-leaf-drift-5',
    },
    {
        startStyle: { right: '1%', top: '10%', animationDelay: '8s', animationDuration: '10s' },
        animName: 'sf-leaf-drift-6',
    },
];
export default function LeafDrift() {
    return (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: '4px',
                    background: 'linear-gradient(to bottom, transparent, rgba(134,239,172,0.15) 30%, rgba(74,222,128,0.2) 60%, transparent)',
                } }), LEAF_CONFIGS.map((config, i) => (_jsx(Leaf, { style: {
                    ...config.startStyle,
                    animationName: config.animName,
                    animationTimingFunction: 'ease-in-out',
                    animationIterationCount: 'infinite',
                } }, i)))] }));
}
