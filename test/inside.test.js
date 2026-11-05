import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inside } from '../lib/projects.js'

test('inside accepts child', () => {
  assert.equal(inside('/projects/p1', '/projects/p1/renders/a.pptx'), true)
})

test('inside accepts same path', () => {
  assert.equal(inside('/projects/p1', '/projects/p1'), true)
})

test('inside rejects parent escape', () => {
  assert.equal(inside('/projects/p1', '/projects/p2/x.pptx'), false)
})

test('inside rejects posix absolute path', () => {
  assert.equal(inside('/projects/p1', '/etc/passwd'), false)
})

test('inside rejects .. escape', () => {
  assert.equal(inside('/projects/p1', '/projects/p1/../p2/x.pptx'), false)
})

test(
  'inside rejects windows drive absolute path',
  { skip: process.platform !== 'win32' },
  () => {
    assert.equal(inside('C:/projects/p1', 'D:/secret/x.pptx'), false)
  },
)

test(
  'inside accepts windows child',
  { skip: process.platform !== 'win32' },
  () => {
    assert.equal(inside('C:/projects/p1', 'C:/projects/p1/renders/a.pptx'), true)
  },
)
