import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * LightRays — soft radial gradient with gentle opacity pulse for the light theme.
 * Positioned at toolbar area (top). Minimal warm glow. Pure CSS, no JS animation.
 */
export default function LightRays() {
    return (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '60%',
                    height: '40%',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(253,224,71,0.12) 0%, rgba(251,191,36,0.06) 40%, transparent 70%)',
                    animation: 'sf-light-pulse 5s ease-in-out infinite',
                } }), _jsx("div", { style: {
                    position: 'absolute',
                    top: 0,
                    left: '30%',
                    width: '40%',
                    height: '30%',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(253,224,71,0.07) 0%, transparent 60%)',
                    animation: 'sf-light-pulse 7s ease-in-out infinite',
                    animationDelay: '2.5s',
                } }), _jsx("div", { style: {
                    position: 'absolute',
                    top: 0,
                    left: '10%',
                    right: '10%',
                    height: '20%',
                    background: 'linear-gradient(180deg, rgba(253,224,71,0.08) 0%, transparent 100%)',
                    animation: 'sf-light-ray-sweep 8s ease-in-out infinite',
                    transformOrigin: '50% 0%',
                } })] }));
}
