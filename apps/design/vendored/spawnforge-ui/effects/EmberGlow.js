import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * EmberGlow — radial-gradient pulse + floating sparks for the ember theme.
 * Pure CSS: no canvas, no requestAnimationFrame, no JS particle systems.
 */
const SPARK_POSITIONS = [
    { left: '5%', bottom: '30%', animationDelay: '0s' },
    { left: '2%', bottom: '60%', animationDelay: '1.2s' },
    { right: '3%', bottom: '40%', animationDelay: '0.8s' },
    { right: '6%', bottom: '70%', animationDelay: '2.1s' },
    { left: '8%', bottom: '50%', animationDelay: '1.6s' },
];
export default function EmberGlow() {
    return (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(ellipse at 0% 50%, rgba(245,158,11,0.08) 0%, transparent 50%)',
                    animation: 'sf-ember-pulse 4s ease-in-out infinite',
                } }), _jsx("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(ellipse at 100% 50%, rgba(245,158,11,0.06) 0%, transparent 50%)',
                    animation: 'sf-ember-pulse 4s ease-in-out infinite',
                    animationDelay: '2s',
                } }), SPARK_POSITIONS.map((pos, i) => (_jsx("div", { style: {
                    position: 'absolute',
                    width: '3px',
                    height: '3px',
                    borderRadius: '50%',
                    background: 'rgba(245,158,11,0.7)',
                    animation: 'sf-spark-float 3s ease-out infinite',
                    ...pos,
                } }, i)))] }));
}
