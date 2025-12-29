# GitHub Usage Guide

This guide provides instructions on common GitHub operations for managing files in this repository.

## How to Delete a File in the Root Folder

There are three main methods to delete a file from the root folder of this GitHub repository:

### Method 1: Using GitHub Web Interface (Easiest)

This is the simplest method if you want to delete a file directly through GitHub's website.

1. **Navigate to the repository** on GitHub (https://github.com/cis2131/CoreBit)
2. **Locate the file** you want to delete in the root folder
3. **Click on the file name** to open it
4. **Click the trash icon** (🗑️) in the top-right corner of the file view
5. **Scroll down** to the "Commit changes" section
6. **Add a commit message** describing what you're deleting (e.g., "Delete obsolete config file")
7. **Optional:** Add an extended description
8. **Choose commit option:**
   - "Commit directly to the main branch" (if you have direct access)
   - "Create a new branch and start a pull request" (recommended for collaborative projects)
9. **Click "Commit changes"** or "Propose changes"

### Method 2: Using Git Command Line

This method is preferred for developers who work with Git regularly.

```bash
# 1. Navigate to your local repository
cd /path/to/CoreBit

# 2. Ensure you're on the correct branch
git checkout main  # or your target branch

# 3. Pull the latest changes
git pull origin main

# 4. Delete the file (replace 'filename.txt' with your file)
git rm filename.txt

# 5. Commit the deletion
git commit -m "Delete filename.txt from root folder"

# 6. Push the changes to GitHub
git push origin main
```

**Note:** If you've already deleted the file from your filesystem:
```bash
# Stage the deletion
git add filename.txt
# or
git add -A

# Commit and push as shown above
git commit -m "Delete filename.txt from root folder"
git push origin main
```

### Method 3: Using GitHub Desktop

For users who prefer a graphical interface:

1. **Open GitHub Desktop**
2. **Select the CoreBit repository** from the repository list
3. **Navigate to the file** in your file explorer or Finder
4. **Delete the file** normally (move to trash/recycle bin)
5. **Return to GitHub Desktop** - you'll see the deleted file in the "Changes" tab
6. **Review the change** to ensure it's correct
7. **Add a commit message** in the summary field (e.g., "Delete filename.txt")
8. **Optional:** Add a description in the description field
9. **Click "Commit to main"** (or your current branch)
10. **Click "Push origin"** to upload the changes to GitHub

## Important Considerations

### Before Deleting Files

- **Backup important files** - Deletion is permanent once pushed
- **Check dependencies** - Ensure no other files or code depend on the file you're deleting
- **Review git history** - Remember that deleted files remain in git history
- **Coordinate with team** - Communicate with team members before deleting shared files

### Best Practices

1. **Use descriptive commit messages** - Explain why the file was deleted
2. **Create a pull request** - For important deletions, use a PR for team review
3. **Test after deletion** - Ensure the application still works after removing the file
4. **Document changes** - Update relevant documentation (README, etc.) if needed

### Recovering Deleted Files

If you need to recover a deleted file:

```bash
# Find the commit where the file was deleted
git log --all --full-history -- filename.txt

# Restore the file from the commit before deletion
git checkout <commit-hash>~1 -- filename.txt

# Commit the restoration
git commit -m "Restore filename.txt"
git push origin main
```

## Common Files You Might Delete

In the CoreBit repository root folder, common files that might be deleted include:

- **Configuration files:** `.env.example`, `*.config.js/ts`
- **Documentation files:** `*.md` files (README.md, DEPLOYMENT.md, etc.)
- **Build artifacts:** `dist/`, `build/` (though these are usually in .gitignore)
- **Package files:** `package.json`, `package-lock.json`
- **Other project files:** `tsconfig.json`, `.replit`, etc.

**Warning:** Be extremely careful when deleting:
- `package.json` - Required for dependency management
- `README.md` - Primary project documentation
- `.gitignore` - Prevents committing unwanted files
- Any configuration files the application depends on

## Getting Help

If you encounter issues:

1. **Check Git status:** `git status`
2. **View recent commits:** `git log --oneline -10`
3. **Undo uncommitted changes:** `git checkout -- filename.txt`
4. **Undo last commit (not pushed):** `git reset HEAD~1`
5. **Consult documentation:** [GitHub Docs](https://docs.github.com)

## Additional Resources

- [GitHub Documentation](https://docs.github.com)
- [Git Command Reference](https://git-scm.com/docs)
- [GitHub Desktop Documentation](https://docs.github.com/en/desktop)
- [Git Basics Tutorial](https://git-scm.com/book/en/v2/Getting-Started-Git-Basics)
