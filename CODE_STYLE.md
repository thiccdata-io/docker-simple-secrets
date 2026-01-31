# Code Style Guide

## TypeScript/JavaScript Standards

### Variable Declarations

**Always use `const` by default. Never use `let` unless absolutely necessary.**

```typescript
// ❌ Bad
let count = 0;
let message = 'hello';

// ✅ Good
const count = 0;
const message = 'hello';

// ✅ Acceptable (mutation is necessary)
const counters = { deployed: 0, updated: 0 };
counters.deployed++;
```

**Rationale:** `const` prevents accidental reassignment and makes code more predictable. Mutating object properties is acceptable when needed for performance or simplicity.

### Iteration

**Prefer `for...of` loops over `.forEach()` for better control flow and performance.**

```typescript
// ❌ Bad - forEach doesn't support early returns
items.forEach(item => {
  if (item.skip) {
    return; // Only returns from callback, not function
  }
  process(item);
});

// ✅ Good - for...of supports continue/break
for (const item of items) {
  if (item.skip) {
    continue;
  }
  process(item);
}

// ✅ Good - when you need the index
for (const [index, item] of items.entries()) {
  console.log(`Item ${index}:`, item);
}
```

**Rationale:** Standard `for` loops provide better control flow (break/continue), clearer semantics, and slightly better performance. Array methods like `.map()`, `.filter()`, `.reduce()` are preferred when transforming data functionally.

### Control Flow

**Avoid `else` clauses. Use early returns and guard clauses instead.**

```typescript
// ❌ Bad
function validate(input: string): boolean {
  if (input.length > 0) {
    return true;
  } else {
    return false;
  }
}

// ✅ Good
function validate(input: string): boolean {
  if (input.length === 0) {
    return false;
  }
  return true;
}

// ❌ Bad
if (condition) {
  doSomething();
} else {
  doSomethingElse();
}

// ✅ Good
if (!condition) {
  doSomethingElse();
  return;
}
doSomething();
```

**Rationale:** Early returns reduce nesting and make the "happy path" more obvious. Code flows top-to-bottom without branches.

### Block Braces

**Always use braces `{}` for control structures, even single-line statements.**

```typescript
// ❌ Bad
if (condition) doSomething();

if (condition) doSomething();

// ✅ Good
if (condition) {
  doSomething();
}
```

**Rationale:** Explicit braces prevent bugs when adding statements and improve readability.

### Async/Await

**Prefer async/await over promise chains.**

```typescript
// ❌ Bad
function getData() {
  return fetch('/api')
    .then(res => res.json())
    .then(data => process(data));
}

// ✅ Good
async function getData() {
  const res = await fetch('/api');
  const data = await res.json();
  return process(data);
}
```

### Error Handling

**Use specific error types and meaningful messages.**

```typescript
// ❌ Bad
catch (error) {
  console.log(error);
}

// ✅ Good
catch (error: any) {
  console.error('Failed to process request:', error);
  throw new Error(`Processing failed: ${error.message}`);
}
```

### Function Organization

**Keep functions focused and single-purpose. Extract helpers when needed.**

```typescript
// ❌ Bad - function does too much
async function processAndDeploy() {
  // validation
  // encryption
  // deployment
  // cleanup
}

// ✅ Good - separated concerns
async function validateInput(input: string): Promise<boolean> { ... }
async function encryptSecret(value: string): Promise<Buffer> { ... }
async function deploySecret(encrypted: Buffer): Promise<void> { ... }
```

### Naming Conventions

- **Variables/Functions:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE` for true constants, `camelCase` for initialized values
- **Types/Interfaces:** `PascalCase`
- **Private fields:** Prefix with `_` (e.g., `_internalState`)

```typescript
// ✅ Good
const MAX_ATTEMPTS = 5;
const deployPath = '/var/tmpfs';

interface UserConfig {
  serviceName: string;
  secretCount: number;
}

function validatePassword(input: string): boolean { ... }
```

### Type Safety

**Avoid `any` when possible. Use specific types or `unknown` with type guards.**

```typescript
// ❌ Bad
function process(data: any) {
  return data.value;
}

// ✅ Good
function process(data: { value: string }): string {
  return data.value;
}

// ✅ Acceptable for truly unknown data
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return String(data.value);
  }
  throw new Error('Invalid data structure');
}
```

### Comments

**Write self-documenting code. Use comments to explain "why", not "what".**

```typescript
// ❌ Bad - comment explains obvious code
// Set count to zero
const count = 0;

// ✅ Good - comment explains reasoning
// Skip hidden files to avoid system directory conflicts
const hasRealContents = contents.some(item => !item.startsWith('.'));
```

### Import Organization

**Group imports logically: external, internal, types.**

```typescript
// ✅ Good
import express, { Request, Response } from 'express';
import path from 'path';
import { exec } from 'child_process';

import { validatePassword } from './auth';
import { deploySecrets } from './deployment';

import type { Service, Secret } from './types';
```

### Security

**Never log or expose sensitive data. Always clean up temporary files.**

```typescript
// ❌ Bad
console.log('Password:', password);
await fs.writeFile('/tmp/password', password);

// ✅ Good
await withPassphraseFile(password, async passphraseFile => {
  // Use passphraseFile securely
  // Cleanup happens automatically
});
```

### Performance

**Use early exits to avoid unnecessary computation.**

```typescript
// ❌ Bad
async function processAll(items: Item[]) {
  const results = [];
  for (const item of items) {
    if (item.isValid()) {
      results.push(await process(item));
    }
  }
  return results;
}

// ✅ Good
async function processAll(items: Item[]) {
  if (items.length === 0) {
    return [];
  }

  const results = [];
  for (const item of items) {
    if (!item.isValid()) {
      continue;
    }
    results.push(await process(item));
  }
  return results;
}
```

## Project-Specific Patterns

### Password Handling

Always use the `withPassphraseFile` helper for GPG operations:

```typescript
await withPassphraseFile(password, async passphraseFile => {
  return await execAsync(`gpg --batch --passphrase-file ${passphraseFile} ...`);
});
```

### Route Handlers

1. Validate inputs early
2. Check authentication
3. Perform operation
4. Return appropriate response

```typescript
app.post('/route', async (req: Request, res: Response) => {
  const { param } = req.body;

  if (!param) {
    return res.status(400).send('<div class="alert alert-error">Param required</div>');
  }

  const password = req.headers['x-user-password'] as string;
  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  try {
    // Perform operation
    res.send(/* success response */);
  } catch (error: any) {
    res.status(500).send(`<div class="alert alert-error">${error.message}</div>`);
  }
});
```

### HTMX Responses

Always return valid HTML fragments with appropriate status codes:

```typescript
// Success with data
res.render('partials/component', { data });

// Error
res.status(400).send('<div class="alert alert-error">Error message</div>');

// Success with message
res.send('<div class="alert alert-success">✓ Operation complete</div>');
```
