import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
function Gear({ size, style, duration, direction = 'cw' }) {
    const rotation = direction === 'cw' ? 'sf-gear-cw' : 'sf-gear-ccw';
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "rgba(217,119,6,0.35)", style: {
            position: 'absolute',
            animation: `${rotation} ${duration}s linear infinite`,
            ...style,
        }, "aria-hidden": "true", children: _jsx("path", { d: "M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.3.07-.61.07-.92s-.03-.63-.07-.93l2-1.56c.18-.14.23-.41.12-.61l-1.9-3.3c-.12-.22-.37-.29-.59-.22l-2.36.94c-.5-.37-1.02-.7-1.62-.94l-.36-2.54C15.18 2.17 14.9 2 14.6 2h-3.8c-.3 0-.56.17-.6.44l-.35 2.54c-.6.24-1.13.57-1.62.94l-2.36-.94c-.22-.07-.47 0-.59.22L3.38 8.5c-.11.2-.05.47.12.61l2 1.56c-.04.3-.07.62-.07.93s.03.63.07.92l-2 1.57c-.18.14-.23.41-.12.61l1.9 3.3c.12.21.37.28.59.22l2.36-.95c.5.38 1.03.7 1.62.95l.35 2.54c.04.27.3.44.6.44h3.8c.3 0 .56-.17.6-.44l.35-2.54c.6-.25 1.12-.57 1.62-.95l2.36.95c.22.06.47 0 .59-.22l1.9-3.3c.11-.2.05-.47-.12-.61l-2-1.57z" }) }));
}
export default function RustGears() {
    return (_jsxs(_Fragment, { children: [_jsx(Gear, { size: 16, duration: 20, direction: "cw", style: { top: '12%', left: '1%' } }), _jsx(Gear, { size: 14, duration: 25, direction: "ccw", style: { bottom: '15%', right: '1.5%' } }), _jsx(Gear, { size: 12, duration: 15, direction: "cw", style: { top: '50%', left: '0.5%' } }), _jsx(Gear, { size: 13, duration: 30, direction: "ccw", style: { top: '25%', right: '1%' } })] }));
}
