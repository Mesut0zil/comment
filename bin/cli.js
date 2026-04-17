#!/usr/bin/env node

/**
 * Migration CLI for establishing the comments schema.
 */

require('dotenv').config();
// We optionally load dotenv if they execute it directly in a standalone context.
// In actual usage, it would run `npx comment-pkg migrate`

const { up, down } = require('../dist/index.js'); // Assumes build format is CJS for CLI or use ts-node

async function run() {
    const command = process.argv[2];

    try {
        if (command === 'migrate' || command === 'up') {
            console.log('Running comment schema migration (up)...');
            await up();
        } else if (command === 'rollback' || command === 'down') {
            console.log('Running comment schema rollback (down)...');
            await down();
        } else {
            console.log('Usage: npx comment migrate | rollback');
        }
        process.exit(0);
    } catch (error) {
        console.error('Database migration failed: ', error);
        process.exit(1);
    }
}

run();
