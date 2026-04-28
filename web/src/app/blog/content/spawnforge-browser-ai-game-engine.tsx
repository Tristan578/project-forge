export default function SpawnForgeBrowserAiGameEngine() {
  return (
    <>
      <p>
        Game development has traditionally required downloading large IDEs, learning complex
        programming languages, and wrestling with build pipelines. SpawnForge takes a different
        approach: everything happens in your browser.
      </p>

      <h2>What is SpawnForge?</h2>
      <p>
        SpawnForge is an AI-native 2D/3D game engine built for the browser. It combines a
        Bevy-based Rust/WebAssembly rendering engine with a React visual editor and 350 MCP
        (Model Context Protocol) commands. You can create games through natural language
        descriptions, visual scripting, or traditional code.
      </p>

      <h2>Browser-Native Architecture</h2>
      <p>
        Under the hood, SpawnForge uses WebGPU for primary rendering with automatic WebGL2
        fallback for older browsers. The engine is written in Rust and compiled to WebAssembly,
        giving near-native performance without plugins or downloads. The editor shell is built
        with Next.js and React, providing a modern, responsive interface.
      </p>
      <p>
        This architecture means there is zero setup friction. Open a URL, start creating. Your
        first entity can exist in under 30 seconds.
      </p>

      <h2>AI-First Design</h2>
      <p>
        SpawnForge was built with AI integration from day one, not bolted on afterward.
        Every engine operation is a JSON command through a single <code>handle_command()</code> entry
        point. This means the visual editor and AI agents use the exact same API — there is no
        separate &ldquo;AI mode.&rdquo;
      </p>
      <p>
        The built-in chat panel lets you describe what you want in plain language. The AI executes
        compound actions — spawning entities, configuring materials, writing scripts — iterating
        across multiple turns until the scene matches your description. 25+ AI modules handle
        everything from scene generation to asset creation.
      </p>

      <h2>350 MCP Commands</h2>
      <p>
        The Model Context Protocol (MCP) server exposes 350 commands across 41 categories. Any
        MCP-compatible agent or LLM can create scenes, configure physics, write game scripts, and
        export finished games — all without touching the UI.
      </p>
      <p>
        Categories span the full engine: transforms, materials, physics, audio, animation,
        particles, tilemaps, scripting, game components, and more. The commands are documented at{' '}
        <a href="https://docs.spawnforge.ai/mcp" className="text-orange-400 hover:underline">
          docs.spawnforge.ai/mcp
        </a>.
      </p>

      <h2>Visual Scripting</h2>
      <p>
        For creators who prefer a visual approach, SpawnForge includes a React Flow-based node
        graph editor with 73 node types across 10 categories. Non-programmers create game logic
        by connecting visual blocks, which compile to TypeScript. The visual scripting system
        covers variables, conditions, loops, events, physics interactions, and more.
      </p>

      <h2>Full Engine Capabilities</h2>
      <p>SpawnForge is not a toy or a prototyping tool. The engine includes:</p>
      <ul>
        <li>PBR materials with 56 presets across 9 categories</li>
        <li>2D and 3D physics powered by Rapier</li>
        <li>Spatial audio with bus mixing, reverb zones, and adaptive music</li>
        <li>GPU particle effects with 9 presets</li>
        <li>Skeletal animation, keyframe animation, and glTF import</li>
        <li>CSG boolean operations and procedural terrain</li>
        <li>Tilemap editor for 2D games</li>
        <li>TypeScript scripting sandbox with 14+ API namespaces</li>
      </ul>

      <h2>Publish Instantly</h2>
      <p>
        One click publishes your game to a shareable URL on spawnforge.ai. Players load and play
        directly in the browser. You can also export as a standalone ZIP with PWA support for
        platforms like itch.io.
      </p>

      <h2>Getting Started</h2>
      <p>
        SpawnForge offers a free tier with no credit card required. Sign up, open the editor, and
        start building. The Starter bundle system provides 11 pre-configured game skeletons
        (Platformer, Shooter, Runner, Puzzle, and more) to get you building in seconds.
      </p>
    </>
  );
}
