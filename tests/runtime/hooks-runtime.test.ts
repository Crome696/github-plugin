import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allHookNames,
  assertNoUnexpectedFakeCommands,
  assertNonDefaultBaseSemantics,
  assertRuntimeResponse,
  cleanupRuntimeRepository,
  commandFor,
  createRuntimeContext,
  deleteGeneratedEntrypoint,
  executeProjectedHook,
  irrelevantCommandFor,
  malformedCommandFor,
  mutateGate,
  overwriteGeneratedEntrypoint,
  overwriteCommitMessage,
  payloadFor,
  prepareRuntimeMode,
  redirectGeneratedRoute,
  writeActiveGitMarker,
} from "./harness.js";
import type { Host, HookName, RuntimeContext, RuntimeMode } from "./types.js";

const hosts: Host[] = ["cursor", "codex"];
const preHooks = allHookNames.filter((hook) => hook !== "post-merge");

const withRuntimeRepository = (callback: (context: RuntimeContext) => void) => {
  const context = createRuntimeContext();
  try {
    callback(context);
  } finally {
    cleanupRuntimeRepository(context);
  }
};

const expectRuntimeFailure = (callback: () => void, message: RegExp) => {
  expect(callback).toThrow(message);
};

const implementationCheckoutRoot = execFileSync(
  "git",
  ["rev-parse", "--show-toplevel"],
  { cwd: process.cwd(), encoding: "utf8" },
).trim();

const implementationCheckoutSnapshot = () => ({
  head: execFileSync("git", ["-C", implementationCheckoutRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync(
    "git",
    ["-C", implementationCheckoutRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  ),
  tracked: execFileSync("git", ["-C", implementationCheckoutRoot, "ls-files", "-z"], { encoding: "utf8" }),
});

describe.sequential("executable generated project-hook runtime oracle", () => {
  for (const hook of allHookNames) {
    it(`${hook} executes irrelevant and protected paths through both generated hosts`, () => {
      withRuntimeRepository((context) => {
        for (const host of hosts) {
          prepareRuntimeMode(context, hook, "irrelevant");
          const irrelevant = executeProjectedHook(
            context,
            host,
            hook,
            "irrelevant",
            payloadFor(host, irrelevantCommandFor(hook), context.repositoryRoot, hook === "post-merge"),
          );
          assertRuntimeResponse(irrelevant, true, false);
          assertNoUnexpectedFakeCommands(context);

          if (hook === "post-merge") {
            prepareRuntimeMode(context, hook, "allow");
            const relevant = executeProjectedHook(
              context,
              host,
              hook,
              "allow",
              payloadFor(host, commandFor(context, hook), context.repositoryRoot, true),
            );
            assertRuntimeResponse(relevant, true, true);
            assertNoUnexpectedFakeCommands(context);
            continue;
          }

          prepareRuntimeMode(context, hook, "missing-gate");
          const denied = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);

          prepareRuntimeMode(context, hook, "allow");
          const allowed = executeProjectedHook(
            context,
            host,
            hook,
            "allow",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(allowed, true);
          assertNoUnexpectedFakeCommands(context);
        }
      });
    }, 30_000);
  }

  it("fails closed for malformed object payloads and compound commands", () => {
    withRuntimeRepository((context) => {
      for (const host of hosts) {
        for (const hook of preHooks) {
          prepareRuntimeMode(context, hook, "missing-gate");
          const missingCommand = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            host === "cursor"
              ? { hook_event_name: "beforeShellExecution", cwd: context.repositoryRoot }
              : { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { cwd: context.repositoryRoot } },
          );
          assertRuntimeResponse(missingCommand, false);

          prepareRuntimeMode(context, hook, "missing-gate");
          const compound = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            payloadFor(host, malformedCommandFor(hook), context.repositoryRoot),
          );
          assertRuntimeResponse(compound, false);
          assertNoUnexpectedFakeCommands(context);
        }
      }

      prepareRuntimeMode(context, "post-merge", "allow");
      for (const host of hosts) {
        const malformedPost = executeProjectedHook(
          context,
          host,
          "post-merge",
          "allow",
          host === "cursor"
            ? []
            : { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { cwd: context.repositoryRoot } },
        );
        assertRuntimeResponse(malformedPost, true, host === "cursor");
      }
    });
  }, 30_000);

  it("detects stale and malformed gate snapshots, unmerged index state, and active operations", () => {
    withRuntimeRepository((context) => {
      for (const hook of preHooks) {
        for (const host of hosts) {
          const mode: RuntimeMode = hook === "pre-commit" ? "stale-gate" : "malformed-gate";
          prepareRuntimeMode(context, hook, mode);
          const denied = executeProjectedHook(
            context,
            host,
            hook,
            mode,
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);
        }
      }

      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-commit", "unmerged-index");
        const unmerged = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "unmerged-index",
          payloadFor(host, commandFor(context, "pre-commit"), context.repositoryRoot),
        );
        assertRuntimeResponse(unmerged, false);

        prepareRuntimeMode(context, "pre-rebase", "active-operation");
        writeActiveGitMarker(context);
        const active = executeProjectedHook(
          context,
          host,
          "pre-rebase",
          "active-operation",
          payloadFor(host, commandFor(context, "pre-rebase"), context.repositoryRoot),
        );
        assertRuntimeResponse(active, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-rebase", "mismatched-gate");
        const mismatched = executeProjectedHook(
          context,
          host,
          "pre-rebase",
          "mismatched-gate",
          payloadFor(host, commandFor(context, "pre-rebase"), context.repositoryRoot),
        );
        assertRuntimeResponse(mismatched, false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  }, 30_000);

  it("binds pre-commit to the exact command, message bytes, and staged index on both hosts", () => {
    withRuntimeRepository((context) => {
      const approvedMessage = readFileSync(context.messagePath, "utf8");
      const canonicalCommand = commandFor(context, "pre-commit");

      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-commit", "allow");
        const allowed = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "allow",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(allowed, true);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-commit", "message-source");
        const alternateSource = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "message-source",
          payloadFor(
            host,
            canonicalCommand.replace(context.messagePath, context.bodyPath),
            context.repositoryRoot,
          ),
        );
        assertRuntimeResponse(alternateSource, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-commit", "message-bytes");
        overwriteCommitMessage(context, "Runtime oracle\n\nUnexpected message bytes.\n");
        const alteredMessage = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "message-bytes",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(alteredMessage, false);
        expect(`${alteredMessage.stdout}\n${alteredMessage.stderr}`).not.toContain("Unexpected message bytes.");
        assertNoUnexpectedFakeCommands(context);
        overwriteCommitMessage(context, approvedMessage);

        prepareRuntimeMode(context, "pre-commit", "allow");
        mutateGate(context, "pre-commit", (gate) => {
          const binding = gate.commit_binding as Record<string, unknown>;
          const messageFile = binding.message_file as Record<string, unknown>;
          messageFile.sha256 = "0".repeat(64);
        });
        const alteredBinding = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "allow",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(alteredBinding, false);
        assertNoUnexpectedFakeCommands(context);

        for (const mode of ["staged-path", "staged-mode", "staged-blob", "staged-deletion"] as const) {
          prepareRuntimeMode(context, "pre-commit", mode);
          const alteredIndex = executeProjectedHook(
            context,
            host,
            "pre-commit",
            mode,
            payloadFor(host, canonicalCommand, context.repositoryRoot),
          );
          assertRuntimeResponse(alteredIndex, false);
          assertNoUnexpectedFakeCommands(context);
        }

        for (const command of [
          `${canonicalCommand} && echo unsupported`,
          `echo unsupported && ${canonicalCommand}`,
          `${canonicalCommand} | echo unsupported`,
          `${canonicalCommand} > commit-output.txt`,
          `env ${canonicalCommand}`,
          `git -C "$(pwd)" commit --cleanup=verbatim --file="${context.messagePath}"`,
          `${canonicalCommand} -- runtime-oracle.txt`,
          `${canonicalCommand.replace("--cleanup=verbatim", "--cleanup=strip")}`,
        ]) {
          prepareRuntimeMode(context, "pre-commit", "allow");
          const deniedCommand = executeProjectedHook(
            context,
            host,
            "pre-commit",
            "allow",
            payloadFor(host, command, context.repositoryRoot),
          );
          assertRuntimeResponse(deniedCommand, false);
          expect(`${deniedCommand.stdout}\n${deniedCommand.stderr}`).not.toContain(
            "Execute generated project hooks.",
          );
          assertNoUnexpectedFakeCommands(context);
        }
      }
    });
  }, 30_000);

  it("handles controlled GitHub CLI failures, invalid JSON, authentication failures, and bounded delays", () => {
    withRuntimeRepository((context) => {
      const cases: Array<{ hook: HookName; mode: RuntimeMode; allow: boolean }> = [
        { hook: "pre-review-submit", mode: "cli-auth-failure", allow: false },
        { hook: "pre-pr-ready", mode: "cli-invalid-json", allow: false },
        { hook: "pre-merge", mode: "cli-failure", allow: false },
        { hook: "pre-pr-ready", mode: "cli-delay", allow: true },
      ];
      for (const testCase of cases) {
        for (const host of hosts) {
          prepareRuntimeMode(context, testCase.hook, testCase.mode);
          const startedAt = Date.now();
          const execution = executeProjectedHook(
            context,
            host,
            testCase.hook,
            testCase.mode,
            payloadFor(host, commandFor(context, testCase.hook), context.repositoryRoot),
          );
          const elapsed = Date.now() - startedAt;
          assertRuntimeResponse(execution, testCase.allow);
          expect(elapsed).toBeLessThan(1_500);
          assertNoUnexpectedFakeCommands(context);
        }
      }
    });
  }, 30_000);

  it("uses the live non-default pull-request base for merge containment", () => {
    withRuntimeRepository((original) => {
      const context = { ...original, baseBranch: "release/2.x" };
      prepareRuntimeMode(context, "post-merge", "allow");
      for (const host of hosts) {
        const execution = executeProjectedHook(
          context,
          host,
          "post-merge",
          "allow",
          payloadFor(host, commandFor(context, "post-merge"), context.repositoryRoot, true),
        );
        assertNonDefaultBaseSemantics(execution, context);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  });

  it("detects disposable projection faults instead of accepting a broken oracle target", () => {
    const faultCases = [
      {
        name: "missing hook file",
        mutate: (context: RuntimeContext, host: Host) => deleteGeneratedEntrypoint(context, host, "pre-commit"),
        expected: /entrypoint|start/i,
      },
      {
        name: "hook cannot start",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(context, host, "pre-commit", "this is not valid JavaScript\n"),
        expected: /exit|start|abnormally/i,
      },
      {
        name: "non-JSON stdout",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(context, host, "pre-commit", "process.stdout.write('not-json\\n');\n"),
        expected: /JSON|valid/i,
      },
      {
        name: "wrong host envelope",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\n');\n"
              : "process.stdout.write(JSON.stringify({permission:'allow'})+'\\n');\n",
          ),
        expected: /keys|envelope|JSON/i,
      },
      {
        name: "wrong exit status",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({permission:'allow'})+'\\n'); process.exitCode=2;\n"
              : "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\n'); process.exitCode=2;\n",
          ),
        expected: /exit/i,
      },
      {
        name: "additional stdout",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({permission:'allow'})+'\\nextra\\n');\n"
              : "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\nextra\\n');\n",
          ),
        expected: /exactly one|JSON line/i,
      },
      {
        name: "wrong manifest checker",
        mutate: (context: RuntimeContext, host: Host) => redirectGeneratedRoute(context, host, "pre-commit", "pre-rebase"),
        expected: /routed|manifest|entrypoint/i,
      },
    ] as const;

    for (const faultCase of faultCases) {
      withRuntimeRepository((context) => {
        for (const host of hosts) {
          prepareRuntimeMode(context, "pre-commit", "allow");
          faultCase.mutate(context, host);
          const execution = executeProjectedHook(
            context,
            host,
            "pre-commit",
            "allow",
            payloadFor(host, commandFor(context, "pre-commit"), context.repositoryRoot),
          );
          expectRuntimeFailure(
            () => assertRuntimeResponse(execution, true),
            faultCase.expected,
          );
        }
      });
    }
  }, 30_000);

  it("does not rely on generated gate placeholders", () => {
    withRuntimeRepository((context) => {
      for (const hook of preHooks) {
        expect(existsSync(`${context.repositoryRoot}/.cursor/hooks/state/${hook}.json`)).toBe(false);
      }
      expect(readFileSync(`${context.repositoryRoot}/.gitignore`, "utf8")).toContain(".cursor/hooks/state/");
    });
  });

  it("leaves the implementation checkout HEAD, status, and tracked files unchanged", () => {
    const before = implementationCheckoutSnapshot();
    withRuntimeRepository((context) => {
      prepareRuntimeMode(context, "post-merge", "irrelevant");
      for (const host of hosts) {
        const execution = executeProjectedHook(
          context,
          host,
          "post-merge",
          "irrelevant",
          payloadFor(host, irrelevantCommandFor("post-merge"), context.repositoryRoot, true),
        );
        assertRuntimeResponse(execution, true, false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
    expect(implementationCheckoutSnapshot()).toEqual(before);
  }, 30_000);
});
