"""Remove only disposable Codex argument-wrapper links from a recovery archive.
All other links, special files and unsafe paths fail closed. No links are followed.
"""
import copy
from pathlib import PurePosixPath
import re
import tarfile


def temporary_wrapper(member,path):
    parts=path.parts
    return (member.issym() and len(parts)>=4 and parts[-4:-2]==('tmp','arg0')
            and re.fullmatch(r'codex-arg0[A-Za-z0-9]+',parts[-2])
            and parts[-1] in {'applypatch','apply_patch','codex-execve-wrapper'})


def sanitize(source,destination,max_bytes=16*1024**3,max_members=100000):
    if source.is_symlink() or not source.is_file():raise ValueError('Expected a regular Codex archive')
    if destination.exists() or destination.is_symlink():raise ValueError('Use a fresh sanitized archive')
    seen=set();total=0;omitted=0;retained=0
    try:
        with tarfile.open(source,'r:*') as archive,tarfile.open(destination,'x:gz') as output:
            destination.chmod(0o600)
            for member in archive:
                path=PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts:raise ValueError('Unsafe Codex archive path')
                normalized=str(path)
                if normalized in seen or len(seen)>=max_members:raise ValueError('Duplicate or oversized Codex inventory')
                seen.add(normalized)
                if temporary_wrapper(member,path):omitted+=1;continue
                if not (member.isfile() or member.isdir()):raise ValueError('Unexpected retained Codex link or special file')
                total+=member.size
                if member.size<0 or total>max_bytes:raise ValueError('Codex archive exceeds the byte budget')
                item=copy.copy(member);item.name=normalized;item.pax_headers={}
                output.addfile(item,None if member.isdir() else archive.extractfile(member));retained+=1
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {'omittedTemporaryLinks':omitted,'retainedEntries':retained}
