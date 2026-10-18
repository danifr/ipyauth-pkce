
import os
import urllib.parse

from dotenv.main import dotenv_values

from ._config import VALID_ID_PROVIDERS


# Hosts for which plain http is acceptable (local development).
_LOCALHOST_HOSTS = ('localhost', '127.0.0.1', '::1')


def is_url(string):
    """Return whether ``string`` is a well-formed http(s) URL.

    Validation rules:
    - the value must be a non-empty string,
    - the scheme must be ``http`` or ``https``,
    - a hostname must be present,
    - embedded credentials (``user:pass@host``) are rejected,
    - plain ``http`` is only allowed for localhost hosts; every other host
      must use ``https``,
    - malformed values (parse errors, invalid port) are rejected.
    """
    if not isinstance(string, str) or not string:
        return False

    try:
        parsed = urllib.parse.urlsplit(string)
        # Accessing .port validates malformed port values (raises ValueError).
        port = parsed.port
    except (ValueError, TypeError):
        return False

    scheme = parsed.scheme.lower()
    if scheme not in ('http', 'https'):
        return False

    host = parsed.hostname
    if not host:
        return False

    # Reject embedded credentials.
    if parsed.username is not None or parsed.password is not None:
        return False

    # A negative or otherwise invalid port surfaced as None above is fine;
    # urlsplit already raised for non-numeric ports.
    if port is not None and not (0 <= port <= 65535):
        return False

    # Plain http is only acceptable for local development hosts.
    if scheme == 'http' and host.lower() not in _LOCALHOST_HOSTS:
        return False

    return True


def load_dotenv(dotenv_folder,
                dotenv_file,
                prefix='IdP',
                suffix='.env'):
    """
    """
    if dotenv_file is None:
        return {}

    msg = 'prefix must be a string in {}'.format(VALID_ID_PROVIDERS)
    if prefix not in VALID_ID_PROVIDERS:
        raise ValueError(msg)

    val = 'ipyauth-' + prefix + '-'
    msg = 'dotenv_file must start with ' + val
    if not dotenv_file.startswith(val):
        raise ValueError(msg)

    msg = 'dotenv_file must end with ' + suffix
    if not dotenv_file.endswith(suffix):
        raise ValueError(msg)

    path_dotenv = os.path.join(dotenv_folder,
                               dotenv_file)
    # Prevent path traversal — resolved path must stay inside dotenv_folder
    real_folder = os.path.realpath(dotenv_folder)
    real_path = os.path.realpath(path_dotenv)
    if not real_path.startswith(real_folder + os.sep) and real_path != real_folder:
        raise ValueError(f'dotenv path escapes folder: {path_dotenv}')
    msg = 'file {} does not exist'.format(path_dotenv)
    if not os.path.exists(path_dotenv):
        raise ValueError(msg)

    dic = dict(dotenv_values(path_dotenv))

    return dic
